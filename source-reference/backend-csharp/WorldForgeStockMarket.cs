using System;
using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeStockMarket : NetworkBehaviour
    {
        public const int CompanyCount = 4;
        public const int HistoryLength = 14;

        public static readonly string[] CompanyNames =
        {
            "Apple",
            "Google",
            "Samsung",
            "Nvidia"
        };

        public struct QuoteState :
            INetworkSerializable,
            IEquatable<QuoteState>
        {
            public byte CompanyId;
            public int Price;
            public int Tick;

            public QuoteState(byte companyId, int price, int tick)
            {
                CompanyId = companyId;
                Price = price;
                Tick = tick;
            }

            public void NetworkSerialize<T>(BufferSerializer<T> serializer)
                where T : IReaderWriter
            {
                serializer.SerializeValue(ref CompanyId);
                serializer.SerializeValue(ref Price);
                serializer.SerializeValue(ref Tick);
            }

            public bool Equals(QuoteState other)
            {
                return CompanyId == other.CompanyId &&
                       Price == other.Price &&
                       Tick == other.Tick;
            }
        }

        public struct HoldingState :
            INetworkSerializable,
            IEquatable<HoldingState>
        {
            public ulong ClientId;
            public byte CompanyId;
            public int Shares;

            public HoldingState(ulong clientId, byte companyId, int shares)
            {
                ClientId = clientId;
                CompanyId = companyId;
                Shares = shares;
            }

            public void NetworkSerialize<T>(BufferSerializer<T> serializer)
                where T : IReaderWriter
            {
                serializer.SerializeValue(ref ClientId);
                serializer.SerializeValue(ref CompanyId);
                serializer.SerializeValue(ref Shares);
            }

            public bool Equals(HoldingState other)
            {
                return ClientId == other.ClientId &&
                       CompanyId == other.CompanyId &&
                       Shares == other.Shares;
            }
        }

        public static WorldForgeStockMarket Current { get; private set; }

        [SerializeField] private float tickIntervalSeconds = 8f;
        [SerializeField] private int maximumSharesPerCompany = 250;

        private NetworkList<QuoteState> quotes;
        private NetworkList<QuoteState> priceHistory;
        private NetworkList<HoldingState> holdings;
        private readonly NetworkVariable<double> nextTickAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        private readonly int[] hiddenBaselines = new int[CompanyCount];
        private readonly float[] hiddenVolatility = new float[CompanyCount];
        private System.Random marketRandom;
        private int observedSession = -1;
        private int tick;

        public NetworkList<QuoteState> Quotes => quotes;
        public NetworkList<QuoteState> PriceHistory => priceHistory;
        public NetworkList<HoldingState> Holdings => holdings;

        public int SecondsUntilTick
        {
            get
            {
                if (NetworkManager == null || !NetworkManager.IsListening)
                {
                    return 0;
                }

                return Mathf.Max(
                    0,
                    Mathf.CeilToInt(
                        (float)(nextTickAt.Value -
                                NetworkManager.ServerTime.Time)));
            }
        }

        private void Awake()
        {
            Current = this;
            quotes = new NetworkList<QuoteState>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
            priceHistory = new NetworkList<QuoteState>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
            holdings = new NetworkList<HoldingState>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
        }

        public override void OnNetworkSpawn()
        {
            Current = this;
            if (IsServer)
            {
                ResetForRound();
            }
        }

        public override void OnNetworkDespawn()
        {
            if (Current == this)
            {
                Current = null;
            }
        }

        public override void OnDestroy()
        {
            quotes?.Dispose();
            priceHistory?.Dispose();
            holdings?.Dispose();
            base.OnDestroy();
        }

        private void Update()
        {
            if (!IsServer || !IsSpawned)
            {
                return;
            }

            var round = WorldForgeRoundDirector.Current;
            if (round == null || !round.IsRoundActive)
            {
                return;
            }

            if (round.SessionNumber != observedSession)
            {
                ResetForRound();
                return;
            }

            if (NetworkManager.ServerTime.Time >= nextTickAt.Value)
            {
                AdvancePrices();
            }
        }

        public int GetPrice(int companyId)
        {
            if (companyId < 0 || companyId >= CompanyCount)
            {
                return 0;
            }

            for (var i = 0; i < quotes.Count; i++)
            {
                if (quotes[i].CompanyId == companyId)
                {
                    return quotes[i].Price;
                }
            }

            return 0;
        }

        public int GetHolding(ulong clientId, int companyId)
        {
            var index = FindHolding(clientId, companyId);
            return index >= 0 ? holdings[index].Shares : 0;
        }

        public List<int> GetHistory(int companyId)
        {
            var result = new List<int>(HistoryLength);
            for (var i = 0; i < priceHistory.Count; i++)
            {
                if (priceHistory[i].CompanyId == companyId)
                {
                    result.Add(priceHistory[i].Price);
                }
            }
            return result;
        }

        public void RequestBuy(
            ulong playerObjectId,
            int companyId,
            int quantity)
        {
            if (!IsSpawned)
            {
                return;
            }

            RequestTradeRpc(
                playerObjectId,
                (byte)Mathf.Clamp(companyId, 0, CompanyCount - 1),
                Mathf.Clamp(quantity, 1, 25));
        }

        public void RequestSell(
            ulong playerObjectId,
            int companyId,
            int quantity)
        {
            if (!IsSpawned)
            {
                return;
            }

            RequestTradeRpc(
                playerObjectId,
                (byte)Mathf.Clamp(companyId, 0, CompanyCount - 1),
                -Mathf.Clamp(quantity, 1, 250));
        }

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void RequestTradeRpc(
            ulong playerObjectId,
            byte companyId,
            int signedQuantity,
            RpcParams rpcParams = default)
        {
            if (companyId >= CompanyCount ||
                signedQuantity == 0 ||
                !TryResolvePlayer(
                    playerObjectId,
                    rpcParams.Receive.SenderClientId,
                    out var player))
            {
                return;
            }

            var round = WorldForgeRoundDirector.Current;
            var economy = WorldForgeRegionalEconomy.Current;
            if (round == null || !round.IsRoundActive || economy == null)
            {
                player.SetOwnerNoticeServer("THE EXCHANGE OPENS WITH THE ROUND");
                return;
            }

            var current = GetHolding(player.OwnerClientId, companyId);
            var price = GetPrice(companyId);
            if (signedQuantity > 0)
            {
                var quantity = Mathf.Min(
                    signedQuantity,
                    maximumSharesPerCompany - current);
                if (quantity <= 0)
                {
                    player.SetOwnerNoticeServer("SHARE LIMIT REACHED");
                    return;
                }

                var cost = quantity * price;
                if (!economy.TryDebitServer(
                        player.OwnerClientId,
                        WorldForgeRegionalEconomy.Resource.Cash,
                        cost,
                        $"stock-buy-{companyId}"))
                {
                    player.SetOwnerNoticeServer($"NEED ${cost}");
                    return;
                }

                SetHolding(player.OwnerClientId, companyId, current + quantity);
                player.SetOwnerNoticeServer(
                    $"BOUGHT {quantity} {CompanyNames[companyId]} @ ${price}");
                return;
            }

            var sellQuantity = Mathf.Min(-signedQuantity, current);
            if (sellQuantity <= 0)
            {
                player.SetOwnerNoticeServer("NO SHARES TO SELL");
                return;
            }

            SetHolding(
                player.OwnerClientId,
                companyId,
                current - sellQuantity);
            economy.CreditServer(
                player.OwnerClientId,
                WorldForgeRegionalEconomy.Resource.Cash,
                sellQuantity * price,
                $"stock-sell-{companyId}");
            player.SetOwnerNoticeServer(
                $"SOLD {sellQuantity} {CompanyNames[companyId]} @ ${price}");
        }

        public string GetMerchantRumorServer(
            ulong clientId,
            int purchaseIndex)
        {
            if (!IsServer)
            {
                return string.Empty;
            }

            var company = Mathf.Abs(
                observedSession * 19 +
                purchaseIndex * 7 +
                (int)(clientId % 997)) % CompanyCount;
            var price = GetPrice(company);
            var baseline = hiddenBaselines[company];
            var name = CompanyNames[company];
            if (price >= baseline * 1.16f)
            {
                return $"{name} is trading well above its usual range.";
            }

            if (price <= baseline * 0.84f)
            {
                return $"{name} is trading well below its usual range.";
            }

            return hiddenVolatility[company] >= 0.095f
                ? $"{name} has been unusually volatile this round."
                : $"{name} has stayed relatively stable this round.";
        }

        private void ResetForRound()
        {
            var round = WorldForgeRoundDirector.Current;
            observedSession = round != null ? round.SessionNumber : 0;
            var seed =
                (round != null ? round.SessionSeed : observedSession * 7919) ^
                unchecked((int)0x5F3759DF);
            marketRandom = new System.Random(seed);
            tick = 0;
            quotes.Clear();
            priceHistory.Clear();
            holdings.Clear();

            for (byte company = 0; company < CompanyCount; company++)
            {
                hiddenBaselines[company] = marketRandom.Next(14, 43);
                hiddenVolatility[company] =
                    0.045f + (float)marketRandom.NextDouble() * 0.085f;
                var initial = Mathf.Max(
                    3,
                    Mathf.RoundToInt(
                        hiddenBaselines[company] *
                        (0.86f +
                         (float)marketRandom.NextDouble() * 0.28f)));
                var quote = new QuoteState(company, initial, tick);
                quotes.Add(quote);
                priceHistory.Add(quote);
            }

            nextTickAt.Value =
                NetworkManager.ServerTime.Time +
                Mathf.Max(3f, tickIntervalSeconds);
            Debug.Log(
                $"[WorldForge] WF_STOCK_MARKET_RESET:{observedSession}");
        }

        private void AdvancePrices()
        {
            tick++;
            for (byte company = 0; company < CompanyCount; company++)
            {
                var previous = GetPrice(company);
                var baseline = hiddenBaselines[company];
                var meanPull = (baseline - previous) * 0.16f;
                var shock =
                    ((float)marketRandom.NextDouble() * 2f - 1f) *
                    baseline *
                    hiddenVolatility[company];
                var activityBias = ActivityBias(company, baseline);
                var next = Mathf.Clamp(
                    Mathf.RoundToInt(previous + meanPull + shock + activityBias),
                    2,
                    120);
                var quote = new QuoteState(company, next, tick);
                quotes[company] = quote;
                priceHistory.Add(quote);
            }

            while (priceHistory.Count > CompanyCount * HistoryLength)
            {
                priceHistory.RemoveAt(0);
            }

            nextTickAt.Value =
                NetworkManager.ServerTime.Time +
                Mathf.Max(3f, tickIntervalSeconds);
        }

        private static float ActivityBias(byte company, int baseline)
        {
            var market = WorldForgeCompactMarketDirector.Current;
            if (market == null)
            {
                return 0f;
            }

            var favored =
                company == 0 &&
                market.HotActivity ==
                WorldForgeCompactMarketDirector.Activity.Foraging ||
                company == 1 &&
                market.HotActivity ==
                WorldForgeCompactMarketDirector.Activity.Mining ||
                company == 2 &&
                market.HotActivity ==
                WorldForgeCompactMarketDirector.Activity.Farming;
            return favored ? baseline * 0.035f : 0f;
        }

        private int FindHolding(ulong clientId, int companyId)
        {
            for (var i = 0; i < holdings.Count; i++)
            {
                if (holdings[i].ClientId == clientId &&
                    holdings[i].CompanyId == companyId)
                {
                    return i;
                }
            }
            return -1;
        }

        private void SetHolding(ulong clientId, int companyId, int shares)
        {
            var index = FindHolding(clientId, companyId);
            var state = new HoldingState(
                clientId,
                (byte)companyId,
                Mathf.Max(0, shares));
            if (index >= 0)
            {
                holdings[index] = state;
            }
            else
            {
                holdings.Add(state);
            }
        }

        private bool TryResolvePlayer(
            ulong playerObjectId,
            ulong senderClientId,
            out WorldForgePlayer player)
        {
            player = null;
            if (NetworkManager == null ||
                NetworkManager.SpawnManager == null ||
                !NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(
                    playerObjectId,
                    out var playerObject) ||
                playerObject.OwnerClientId != senderClientId)
            {
                return false;
            }

            player = playerObject.GetComponent<WorldForgePlayer>();
            return player != null;
        }
    }
}
