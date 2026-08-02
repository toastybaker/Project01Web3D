using System;
using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeFarmDirector : NetworkBehaviour
    {
        public struct PlayerFarmState :
            INetworkSerializable,
            IEquatable<PlayerFarmState>
        {
            public ulong ClientId;
            public byte SelectedCrop;
            public int LettuceSeeds;
            public int MushroomSeeds;
            public int PumpkinSeeds;
            public int TomatoSeeds;
            public int WatermelonSeeds;
            public int LettuceProduce;
            public int MushroomProduce;
            public int PumpkinProduce;
            public int TomatoProduce;
            public int WatermelonProduce;

            public PlayerFarmState(ulong clientId)
            {
                ClientId = clientId;
                SelectedCrop = (byte)WorldForgeFarmCatalog.Crop.Lettuce;
                LettuceSeeds = 0;
                MushroomSeeds = 0;
                PumpkinSeeds = 0;
                TomatoSeeds = 0;
                WatermelonSeeds = 0;
                LettuceProduce = 0;
                MushroomProduce = 0;
                PumpkinProduce = 0;
                TomatoProduce = 0;
                WatermelonProduce = 0;
            }

            public void NetworkSerialize<T>(BufferSerializer<T> serializer)
                where T : IReaderWriter
            {
                serializer.SerializeValue(ref ClientId);
                serializer.SerializeValue(ref SelectedCrop);
                serializer.SerializeValue(ref LettuceSeeds);
                serializer.SerializeValue(ref MushroomSeeds);
                serializer.SerializeValue(ref PumpkinSeeds);
                serializer.SerializeValue(ref TomatoSeeds);
                serializer.SerializeValue(ref WatermelonSeeds);
                serializer.SerializeValue(ref LettuceProduce);
                serializer.SerializeValue(ref MushroomProduce);
                serializer.SerializeValue(ref PumpkinProduce);
                serializer.SerializeValue(ref TomatoProduce);
                serializer.SerializeValue(ref WatermelonProduce);
            }

            public bool Equals(PlayerFarmState other)
            {
                return ClientId == other.ClientId &&
                       SelectedCrop == other.SelectedCrop &&
                       LettuceSeeds == other.LettuceSeeds &&
                       MushroomSeeds == other.MushroomSeeds &&
                       PumpkinSeeds == other.PumpkinSeeds &&
                       TomatoSeeds == other.TomatoSeeds &&
                       WatermelonSeeds == other.WatermelonSeeds &&
                       LettuceProduce == other.LettuceProduce &&
                       MushroomProduce == other.MushroomProduce &&
                       PumpkinProduce == other.PumpkinProduce &&
                       TomatoProduce == other.TomatoProduce &&
                       WatermelonProduce == other.WatermelonProduce;
            }
        }

        public static WorldForgeFarmDirector Current { get; private set; }

        [SerializeField] private float marketShiftSeconds = 82f;

        private readonly NetworkVariable<double> nextMarketShiftAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> marketCycle = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<byte> featuredCrop = new(
            (byte)WorldForgeFarmCatalog.Crop.Lettuce,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> lettucePrice = new(
            3,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> mushroomPrice = new(
            6,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> pumpkinPrice = new(
            9,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> tomatoPrice = new(
            6,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> watermelonPrice = new(
            12,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> lettuceStock = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> mushroomStock = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> pumpkinStock = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> tomatoStock = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> watermelonStock = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        private NetworkList<PlayerFarmState> playerStates;
        private int observedSession = -1;

        public NetworkList<PlayerFarmState> PlayerStates => playerStates;
        public WorldForgeFarmCatalog.Crop FeaturedCrop =>
            (WorldForgeFarmCatalog.Crop)featuredCrop.Value;
        public int MarketCycle => marketCycle.Value;

        private void Awake()
        {
            Current = this;
            playerStates = new NetworkList<PlayerFarmState>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
        }

        public override void OnNetworkSpawn()
        {
            Current = this;
            if (!IsServer)
            {
                return;
            }

            NetworkManager.OnClientConnectedCallback += OnClientConnected;
            NetworkManager.OnClientDisconnectCallback += OnClientDisconnected;
            foreach (var clientId in NetworkManager.ConnectedClientsIds)
            {
                EnsureState(clientId);
            }

            ResetMarketForRound();
            Debug.Log("[WorldForge] WF_FARM_DIRECTOR_READY");
        }

        public override void OnNetworkDespawn()
        {
            if (NetworkManager != null && IsServer)
            {
                NetworkManager.OnClientConnectedCallback -= OnClientConnected;
                NetworkManager.OnClientDisconnectCallback -= OnClientDisconnected;
            }

            if (Current == this)
            {
                Current = null;
            }
        }

        public override void OnDestroy()
        {
            playerStates?.Dispose();
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

            if (observedSession != round.SessionNumber)
            {
                ResetPlayersForRound();
                ResetMarketForRound();
                return;
            }

            if (NetworkManager.ServerTime.Time >= nextMarketShiftAt.Value)
            {
                AdvanceMarket();
            }
        }

        public WorldForgeFarmCatalog.Crop GetSelectedCrop(ulong clientId)
        {
            var index = FindStateIndex(clientId);
            return index >= 0
                ? (WorldForgeFarmCatalog.Crop)playerStates[index].SelectedCrop
                : WorldForgeFarmCatalog.Crop.Lettuce;
        }

        public int GetSeedCount(
            ulong clientId,
            WorldForgeFarmCatalog.Crop crop)
        {
            var index = FindStateIndex(clientId);
            return index >= 0
                ? ReadSeeds(playerStates[index], crop)
                : 0;
        }

        public int GetProduceCount(
            ulong clientId,
            WorldForgeFarmCatalog.Crop crop)
        {
            var index = FindStateIndex(clientId);
            return index >= 0
                ? ReadProduce(playerStates[index], crop)
                : 0;
        }

        public int GetMarketPrice(WorldForgeFarmCatalog.Crop crop)
        {
            return crop switch
            {
                WorldForgeFarmCatalog.Crop.Lettuce => lettucePrice.Value,
                WorldForgeFarmCatalog.Crop.Mushroom => mushroomPrice.Value,
                WorldForgeFarmCatalog.Crop.Pumpkin => pumpkinPrice.Value,
                WorldForgeFarmCatalog.Crop.Tomato => tomatoPrice.Value,
                WorldForgeFarmCatalog.Crop.Watermelon => watermelonPrice.Value,
                _ => 0
            };
        }

        public int GetSeedStock(WorldForgeFarmCatalog.Crop crop)
        {
            return crop switch
            {
                WorldForgeFarmCatalog.Crop.Lettuce => lettuceStock.Value,
                WorldForgeFarmCatalog.Crop.Mushroom => mushroomStock.Value,
                WorldForgeFarmCatalog.Crop.Pumpkin => pumpkinStock.Value,
                WorldForgeFarmCatalog.Crop.Tomato => tomatoStock.Value,
                WorldForgeFarmCatalog.Crop.Watermelon => watermelonStock.Value,
                _ => 0
            };
        }

        public int SecondsUntilMarketShift
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
                        (float)(nextMarketShiftAt.Value -
                                NetworkManager.ServerTime.Time)));
            }
        }

        public bool TryBuySeedPackServer(
            WorldForgePlayer player,
            WorldForgeFarmCatalog.Crop crop)
        {
            if (!IsServer || player == null || !IsValidCrop(crop))
            {
                return false;
            }

            EnsureState(player.OwnerClientId);
            var definition = WorldForgeFarmCatalog.Get(crop);
            if (GetSeedStock(crop) <= 0)
            {
                if (GetSeedCount(player.OwnerClientId, crop) > 0)
                {
                    SelectCropServer(player.OwnerClientId, crop);
                    player.SetOwnerNoticeServer(
                        $"{definition.DisplayName} SELECTED");
                }
                else
                {
                    player.SetOwnerNoticeServer("SOLD OUT - STOCK REFILLS SOON");
                }
                return false;
            }

            var economy = WorldForgeRegionalEconomy.Current;
            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            var seedItemId = SeedItemId(crop);
            if (inventory == null ||
                !inventory.CanAdd(
                    seedItemId,
                    definition.SeedsPerPack))
            {
                player.SetOwnerNoticeServer("NOT ENOUGH HOTBAR SPACE");
                return false;
            }
            if (economy == null ||
                !economy.TryDebitServer(
                    player.OwnerClientId,
                    WorldForgeRegionalEconomy.Resource.Cash,
                    definition.SeedCost,
                    $"farm-seeds-{crop}"))
            {
                player.SetOwnerNoticeServer(
                    $"NEED ${definition.SeedCost}");
                return false;
            }

            SetStock(crop, GetSeedStock(crop) - 1);
            var index = FindStateIndex(player.OwnerClientId);
            var state = playerStates[index];
            WriteSeeds(
                ref state,
                crop,
                ReadSeeds(state, crop) + definition.SeedsPerPack);
            state.SelectedCrop = (byte)crop;
            playerStates[index] = state;
            inventory.TryAddServer(
                seedItemId,
                definition.SeedsPerPack);
            player.SetOwnerNoticeServer(
                $"+{definition.SeedsPerPack} {definition.DisplayName} SEEDS");
            return true;
        }

        public bool TryConsumeSelectedSeedServer(
            ulong clientId,
            out WorldForgeFarmCatalog.Crop crop)
        {
            crop = WorldForgeFarmCatalog.Crop.None;
            if (!IsServer)
            {
                return false;
            }

            EnsureState(clientId);
            var index = FindStateIndex(clientId);
            var state = playerStates[index];
            crop = (WorldForgeFarmCatalog.Crop)state.SelectedCrop;
            var available = ReadSeeds(state, crop);
            if (available <= 0)
            {
                return false;
            }

            var inventory = FindInventory(clientId);
            if (inventory == null ||
                !inventory.TryRemoveServer(SeedItemId(crop), 1))
            {
                return false;
            }

            WriteSeeds(ref state, crop, available - 1);
            playerStates[index] = state;
            return true;
        }

        public bool CreditHarvestServer(
            WorldForgePlayer player,
            WorldForgeFarmCatalog.Crop crop,
            int amount)
        {
            if (!IsServer || player == null || amount <= 0)
            {
                return false;
            }

            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            var produceItemId = ProduceItemId(crop);
            if (inventory == null ||
                !inventory.CanAdd(produceItemId, amount))
            {
                player.SetOwnerNoticeServer("NOT ENOUGH HOTBAR SPACE");
                return false;
            }

            EnsureState(player.OwnerClientId);
            var index = FindStateIndex(player.OwnerClientId);
            var state = playerStates[index];
            WriteProduce(
                ref state,
                crop,
                ReadProduce(state, crop) + amount);
            playerStates[index] = state;
            inventory.TryAddServer(produceItemId, amount);
            player.SetOwnerNoticeServer(
                $"+{amount} {WorldForgeFarmCatalog.Get(crop).DisplayName}");
            return true;
        }

        public bool TrySellProduceServer(
            WorldForgePlayer player,
            WorldForgeFarmCatalog.Crop crop)
        {
            if (!IsServer || player == null || !IsValidCrop(crop))
            {
                return false;
            }

            EnsureState(player.OwnerClientId);
            var index = FindStateIndex(player.OwnerClientId);
            var state = playerStates[index];
            var amount = ReadProduce(state, crop);
            if (amount <= 0)
            {
                player.SetOwnerNoticeServer("NOTHING TO SELL");
                return false;
            }

            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            if (inventory == null ||
                !inventory.TryRemoveServer(ProduceItemId(crop), amount))
            {
                player.SetOwnerNoticeServer("PRODUCE INVENTORY IS OUT OF SYNC");
                return false;
            }

            var total = amount * GetMarketPrice(crop);
            if (WorldForgeCompactCompetitionDirector.Current != null)
            {
                total =
                    WorldForgeCompactCompetitionDirector.Current.ApplyRouteBonus(
                        WorldForgeCompactCompetitionDirector.Route.Farming,
                        total);
            }
            WriteProduce(ref state, crop, 0);
            playerStates[index] = state;
            WorldForgeRegionalEconomy.Current?.CreditServer(
                player.OwnerClientId,
                WorldForgeRegionalEconomy.Resource.Cash,
                total,
                $"farm-market-{crop}");
            WorldForgeRoundDirector.Current?.AwardScoreServer(
                player.OwnerClientId,
                total,
                $"farm-market-{crop}");
            WorldForgeCompactCompetitionDirector.Current?
                .NotifyActivityServer(
                    player.OwnerClientId,
                    WorldForgeCompactCompetitionDirector.Route.Farming,
                    total,
                    $"farm-market-{crop}");
            player.SetOwnerNoticeServer(
                $"SOLD {amount} FOR ${total}");
            return true;
        }

        private WorldForgeHotbarInventory FindInventory(ulong clientId)
        {
            if (NetworkManager == null ||
                !NetworkManager.ConnectedClients.TryGetValue(
                    clientId,
                    out var client) ||
                client.PlayerObject == null)
            {
                return null;
            }

            return client.PlayerObject
                .GetComponent<WorldForgeHotbarInventory>();
        }

        private static string SeedItemId(
            WorldForgeFarmCatalog.Crop crop)
        {
            return crop + " Seeds";
        }

        public static string ProduceItemId(
            WorldForgeFarmCatalog.Crop crop)
        {
            return crop.ToString();
        }

        private void ResetPlayersForRound()
        {
            for (var i = 0; i < playerStates.Count; i++)
            {
                playerStates[i] =
                    new PlayerFarmState(playerStates[i].ClientId);
            }
        }

        private void ResetMarketForRound()
        {
            var round = WorldForgeRoundDirector.Current;
            observedSession = round != null ? round.SessionNumber : 0;
            marketCycle.Value = 0;
            for (var i = 0; i < WorldForgeFarmCatalog.CropCount; i++)
            {
                var crop = WorldForgeFarmCatalog.FromIndex(i);
                SetStock(crop, WorldForgeFarmCatalog.Get(crop).InitialStock);
            }

            RepriceMarket();
            nextMarketShiftAt.Value =
                NetworkManager.ServerTime.Time +
                Mathf.Max(45f, marketShiftSeconds);
        }

        private void AdvanceMarket()
        {
            marketCycle.Value++;
            for (var i = 0; i < WorldForgeFarmCatalog.CropCount; i++)
            {
                var crop = WorldForgeFarmCatalog.FromIndex(i);
                var definition = WorldForgeFarmCatalog.Get(crop);
                SetStock(
                    crop,
                    Mathf.Min(
                        definition.InitialStock,
                        GetSeedStock(crop) + definition.StockRefill));
            }

            RepriceMarket();
            nextMarketShiftAt.Value =
                NetworkManager.ServerTime.Time +
                Mathf.Max(45f, marketShiftSeconds);
            Debug.Log(
                $"[WorldForge] WF_FARM_MARKET_SHIFT:" +
                $"{marketCycle.Value}:{FeaturedCrop}");
        }

        private void RepriceMarket()
        {
            var round = WorldForgeRoundDirector.Current;
            var seed = (round != null ? round.SessionSeed : 173) +
                       marketCycle.Value * 7919;
            var hotIndex = PositiveHash(seed, 17) %
                           WorldForgeFarmCatalog.CropCount;
            featuredCrop.Value =
                (byte)WorldForgeFarmCatalog.FromIndex(hotIndex);

            for (var i = 0; i < WorldForgeFarmCatalog.CropCount; i++)
            {
                var crop = WorldForgeFarmCatalog.FromIndex(i);
                var definition = WorldForgeFarmCatalog.Get(crop);
                var swing = PositiveHash(seed, i * 101 + 29) %
                            (definition.VolatilityPercent * 2 + 1) -
                            definition.VolatilityPercent;
                var percent = 100 + swing;
                if (i == hotIndex)
                {
                    percent += 45;
                }

                var price = Mathf.Max(
                    1,
                    Mathf.RoundToInt(
                        definition.BaseSalePrice * percent / 100f));
                SetPrice(crop, price);
            }
        }

        private void OnClientConnected(ulong clientId)
        {
            EnsureState(clientId);
        }

        private void OnClientDisconnected(ulong clientId)
        {
            var index = FindStateIndex(clientId);
            if (index >= 0)
            {
                playerStates.RemoveAt(index);
            }
        }

        private void EnsureState(ulong clientId)
        {
            if (FindStateIndex(clientId) < 0)
            {
                playerStates.Add(new PlayerFarmState(clientId));
            }
        }

        private int FindStateIndex(ulong clientId)
        {
            if (playerStates == null)
            {
                return -1;
            }

            for (var i = 0; i < playerStates.Count; i++)
            {
                if (playerStates[i].ClientId == clientId)
                {
                    return i;
                }
            }

            return -1;
        }

        private void SelectCropServer(
            ulong clientId,
            WorldForgeFarmCatalog.Crop crop)
        {
            var index = FindStateIndex(clientId);
            if (index < 0)
            {
                return;
            }

            var state = playerStates[index];
            state.SelectedCrop = (byte)crop;
            playerStates[index] = state;
        }

        private void SetPrice(
            WorldForgeFarmCatalog.Crop crop,
            int value)
        {
            switch (crop)
            {
                case WorldForgeFarmCatalog.Crop.Lettuce:
                    lettucePrice.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Mushroom:
                    mushroomPrice.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Pumpkin:
                    pumpkinPrice.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Tomato:
                    tomatoPrice.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Watermelon:
                    watermelonPrice.Value = value;
                    break;
            }
        }

        private void SetStock(
            WorldForgeFarmCatalog.Crop crop,
            int value)
        {
            value = Mathf.Max(0, value);
            switch (crop)
            {
                case WorldForgeFarmCatalog.Crop.Lettuce:
                    lettuceStock.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Mushroom:
                    mushroomStock.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Pumpkin:
                    pumpkinStock.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Tomato:
                    tomatoStock.Value = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Watermelon:
                    watermelonStock.Value = value;
                    break;
            }
        }

        private static bool IsValidCrop(WorldForgeFarmCatalog.Crop crop)
        {
            return WorldForgeFarmCatalog.ToIndex(crop) >= 0;
        }

        private static int PositiveHash(int first, int second)
        {
            unchecked
            {
                var value = first;
                value = value * 397 ^ second;
                value ^= value >> 16;
                return value == int.MinValue
                    ? int.MaxValue
                    : Mathf.Abs(value);
            }
        }

        private static int ReadSeeds(
            PlayerFarmState state,
            WorldForgeFarmCatalog.Crop crop)
        {
            return crop switch
            {
                WorldForgeFarmCatalog.Crop.Lettuce => state.LettuceSeeds,
                WorldForgeFarmCatalog.Crop.Mushroom => state.MushroomSeeds,
                WorldForgeFarmCatalog.Crop.Pumpkin => state.PumpkinSeeds,
                WorldForgeFarmCatalog.Crop.Tomato => state.TomatoSeeds,
                WorldForgeFarmCatalog.Crop.Watermelon => state.WatermelonSeeds,
                _ => 0
            };
        }

        private static void WriteSeeds(
            ref PlayerFarmState state,
            WorldForgeFarmCatalog.Crop crop,
            int value)
        {
            switch (crop)
            {
                case WorldForgeFarmCatalog.Crop.Lettuce:
                    state.LettuceSeeds = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Mushroom:
                    state.MushroomSeeds = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Pumpkin:
                    state.PumpkinSeeds = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Tomato:
                    state.TomatoSeeds = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Watermelon:
                    state.WatermelonSeeds = value;
                    break;
            }
        }

        private static int ReadProduce(
            PlayerFarmState state,
            WorldForgeFarmCatalog.Crop crop)
        {
            return crop switch
            {
                WorldForgeFarmCatalog.Crop.Lettuce => state.LettuceProduce,
                WorldForgeFarmCatalog.Crop.Mushroom => state.MushroomProduce,
                WorldForgeFarmCatalog.Crop.Pumpkin => state.PumpkinProduce,
                WorldForgeFarmCatalog.Crop.Tomato => state.TomatoProduce,
                WorldForgeFarmCatalog.Crop.Watermelon => state.WatermelonProduce,
                _ => 0
            };
        }

        private static void WriteProduce(
            ref PlayerFarmState state,
            WorldForgeFarmCatalog.Crop crop,
            int value)
        {
            switch (crop)
            {
                case WorldForgeFarmCatalog.Crop.Lettuce:
                    state.LettuceProduce = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Mushroom:
                    state.MushroomProduce = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Pumpkin:
                    state.PumpkinProduce = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Tomato:
                    state.TomatoProduce = value;
                    break;
                case WorldForgeFarmCatalog.Crop.Watermelon:
                    state.WatermelonProduce = value;
                    break;
            }
        }
    }
}
