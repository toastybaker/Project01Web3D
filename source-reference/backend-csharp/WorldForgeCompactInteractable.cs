using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeCompactInteractable :
        NetworkBehaviour,
        IWorldForgeInteractable
    {
        public enum Kind : byte
        {
            Portal,
            Mine,
            Forage,
            Farm,
            ShopUpgrade,
            FarmPlotClaim
        }

        private static readonly Dictionary<int, WorldForgeCompactInteractable>
            FarmClaims = new();

        [SerializeField] private Kind kind;
        [SerializeField] private string displayName = "USE";
        [SerializeField] private int cashValue = 4;
        [SerializeField] private float cooldownSeconds = 3f;
        [SerializeField] private int purchaseCost = 40;
        [SerializeField] private int accessId = 40;
        [SerializeField] private Vector3 travelDestination;
        [SerializeField] private Renderer feedbackRenderer;
        [SerializeField] private Color readyColor = new(0.3f, 0.92f, 0.56f);
        [SerializeField] private Color waitingColor = new(0.32f, 0.36f, 0.42f);

        private readonly NetworkVariable<double> readyAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<ulong> claimedBy = new(
            ulong.MaxValue,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> claimedSession = new(
            -1,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<byte> farmStage = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<byte> plantedCrop = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> farmSession = new(
            -1,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private MaterialPropertyBlock propertyBlock;
        private Vector3 baseScale;

        public bool UsesRightClick => kind == Kind.FarmPlotClaim;

        public void Configure(
            Kind newKind,
            string newDisplayName,
            int newCashValue,
            float newCooldown,
            int newPurchaseCost,
            int newAccessId,
            Vector3 newDestination,
            Renderer newFeedbackRenderer,
            Color newReadyColor)
        {
            kind = newKind;
            displayName = newDisplayName;
            cashValue = Mathf.Max(0, newCashValue);
            cooldownSeconds = Mathf.Max(0.1f, newCooldown);
            purchaseCost = Mathf.Max(0, newPurchaseCost);
            accessId = newAccessId;
            travelDestination = newDestination;
            feedbackRenderer = newFeedbackRenderer;
            readyColor = newReadyColor;
        }

        private void Awake()
        {
            propertyBlock = new MaterialPropertyBlock();
            baseScale = transform.localScale;
        }

        public override void OnNetworkSpawn()
        {
            if (IsServer && kind == Kind.FarmPlotClaim)
            {
                FarmClaims[accessId] = this;
            }
        }

        public override void OnNetworkDespawn()
        {
            if (kind == Kind.FarmPlotClaim &&
                FarmClaims.TryGetValue(accessId, out var registered) &&
                registered == this)
            {
                FarmClaims.Remove(accessId);
            }
        }

        private void Update()
        {
            // Enter Play Mode can preserve scene objects when scene/domain reload
            // options are disabled. Rehydrate transient presentation state instead
            // of allowing every interactable to throw once per frame.
            if (baseScale == Vector3.zero)
            {
                baseScale = transform.localScale;
            }

            if (IsServer && kind == Kind.Farm)
            {
                var round = WorldForgeRoundDirector.Current;
                if (round != null && farmSession.Value != round.SessionNumber)
                {
                    farmSession.Value = round.SessionNumber;
                    farmStage.Value = 0;
                    plantedCrop.Value = 0;
                    readyAt.Value = 0d;
                }
            }

            var ready = IsReady();
            var pulse = ready && kind != Kind.Portal
                ? 1f + Mathf.Sin(Time.unscaledTime * 3.5f) * 0.035f
                : 1f;
            transform.localScale = Vector3.Lerp(
                transform.localScale,
                baseScale * pulse,
                1f - Mathf.Exp(-10f * Time.unscaledDeltaTime));

            if (feedbackRenderer == null)
            {
                return;
            }

            propertyBlock ??= new MaterialPropertyBlock();
            feedbackRenderer.GetPropertyBlock(propertyBlock);
            var color = ready ? readyColor : waitingColor;
            propertyBlock.SetColor("_BaseColor", color);
            if (feedbackRenderer.sharedMaterial != null &&
                feedbackRenderer.sharedMaterial.HasProperty("_EmissionColor"))
            {
                propertyBlock.SetColor("_EmissionColor", ready ? color * 0.7f : Color.black);
            }
            feedbackRenderer.SetPropertyBlock(propertyBlock);
        }

        public string GetPrompt(WorldForgePlayer player)
        {
            if (player == null)
            {
                return string.Empty;
            }

            var round = WorldForgeRoundDirector.Current;
            if (kind != Kind.Portal &&
                (round == null || !round.IsRoundActive))
            {
                return "START THE ROUND FIRST";
            }

            var economy = WorldForgeRegionalEconomy.Current;
            return kind switch
            {
                Kind.Portal => displayName,
                Kind.Mine when economy != null &&
                               !HasRequiredMiningAccess(
                                   economy,
                                   player.OwnerClientId) =>
                    accessId >= 4
                        ? "NEED GOLD PICKAXE"
                        : "NEED IRON PICKAXE",
                Kind.Mine => IsReady()
                    ? $"MINE {displayName}"
                    : "ORE IS REGROWING",
                Kind.Forage => IsReady()
                    ? $"GATHER {displayName}"
                    : "THIS PATCH IS REGROWING",
                Kind.Farm when economy != null &&
                               !economy.HasAccess(player.OwnerClientId, accessId) =>
                    "CLAIM THIS FARM FIRST",
                Kind.Farm when farmStage.Value == 0 =>
                    SelectedCrop(player) == WorldForgeFarmCatalog.Crop.None
                        ? "SELECT SEEDS"
                        : $"PLANT {WorldForgeFarmCatalog.Get(SelectedCrop(player)).DisplayName}",
                Kind.Farm => IsReady()
                    ? $"HARVEST {WorldForgeFarmCatalog.Get((WorldForgeFarmCatalog.Crop)plantedCrop.Value).DisplayName}"
                    : "CROPS ARE GROWING",
                Kind.ShopUpgrade when economy != null &&
                                      economy.HasAccess(player.OwnerClientId, accessId) =>
                    "ALREADY OWNED",
                Kind.ShopUpgrade => $"{displayName}  ${purchaseCost}",
                Kind.FarmPlotClaim when !HasCurrentClaim =>
                    $"RMB  CLAIM {displayName}",
                Kind.FarmPlotClaim when claimedBy.Value == player.OwnerClientId =>
                    $"{displayName}  YOURS",
                Kind.FarmPlotClaim => $"{displayName}  TAKEN",
                _ => displayName
            };
        }

        public void Interact(WorldForgePlayer player)
        {
            if (player == null || !player.IsOwner || !IsSpawned || UsesRightClick)
            {
                return;
            }

            RequestUseRpc(player.NetworkObjectId);
        }

        public void InteractRightClick(WorldForgePlayer player)
        {
            if (player == null || !player.IsOwner || !IsSpawned || !UsesRightClick) return;
            RequestUseRpc(player.NetworkObjectId);
        }

        private bool IsReady()
        {
            if (kind is Kind.Portal or Kind.ShopUpgrade)
            {
                return true;
            }

            if (kind == Kind.FarmPlotClaim)
            {
                return !HasCurrentClaim;
            }

            if (kind == Kind.Farm && farmStage.Value == 0)
            {
                return true;
            }

            var now = NetworkManager != null && NetworkManager.IsListening
                ? NetworkManager.ServerTime.Time
                : Time.unscaledTimeAsDouble;
            return now >= readyAt.Value;
        }

        private bool HasRequiredMiningAccess(
            WorldForgeRegionalEconomy economy,
            ulong clientId)
        {
            if (kind != Kind.Mine || accessId <= 0 || economy == null)
            {
                return true;
            }

            return accessId switch
            {
                1 => economy.HasAccess(clientId, 1) ||
                     economy.HasAccess(clientId, 4),
                4 => economy.HasAccess(clientId, 4),
                _ => economy.HasAccess(clientId, accessId)
            };
        }

        private int GetReward(ulong clientId)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            var reward = cashValue;
            if (economy != null)
            {
                reward += kind switch
                {
                    Kind.Mine when economy.HasAccess(clientId, 4) =>
                        Mathf.Max(4, cashValue),
                    Kind.Mine when economy.HasAccess(clientId, 1) =>
                        Mathf.Max(2, cashValue / 2),
                    Kind.Forage when economy.HasAccess(clientId, 5) =>
                        Mathf.Max(3, cashValue),
                    Kind.Forage when economy.HasAccess(clientId, 2) =>
                        Mathf.Max(2, cashValue / 2),
                    Kind.Farm when economy.HasAccess(clientId, 6) =>
                        Mathf.Max(6, cashValue),
                    Kind.Farm when economy.HasAccess(clientId, 3) =>
                        Mathf.Max(3, cashValue / 2),
                    _ => 0
                };
            }

            var competition = WorldForgeCompactCompetitionDirector.Current;
            if (competition == null)
            {
                return WorldForgeCompactMarketDirector.Current != null
                    ? WorldForgeCompactMarketDirector.Current.ApplyDemand(
                        kind,
                        reward)
                    : reward;
            }

            var route = kind switch
            {
                Kind.Mine =>
                    WorldForgeCompactCompetitionDirector.Route.Mining,
                Kind.Forage =>
                    WorldForgeCompactCompetitionDirector.Route.Foraging,
                Kind.Farm =>
                    WorldForgeCompactCompetitionDirector.Route.Farming,
                _ => (WorldForgeCompactCompetitionDirector.Route?)null
            };
            return route.HasValue
                ? competition.ApplyRouteBonus(route.Value, reward)
                : reward;
        }

        private float GetEffectiveCooldown(ulong clientId)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            if (economy == null)
            {
                return cooldownSeconds;
            }

            var speedMultiplier = kind switch
            {
                Kind.Mine when economy.HasAccess(clientId, 4) => 0.62f,
                Kind.Mine when economy.HasAccess(clientId, 1) => 0.82f,
                Kind.Forage when economy.HasAccess(clientId, 5) => 0.62f,
                Kind.Forage when economy.HasAccess(clientId, 2) => 0.82f,
                Kind.Farm when economy.HasAccess(clientId, 6) => 0.58f,
                Kind.Farm when economy.HasAccess(clientId, 3) => 0.78f,
                _ => 1f
            };
            return Mathf.Max(0.5f, cooldownSeconds * speedMultiplier);
        }

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void RequestUseRpc(
            ulong playerObjectId,
            RpcParams rpcParams = default)
        {
            if (!TryResolvePlayer(
                    playerObjectId,
                    rpcParams.Receive.SenderClientId,
                    out var player) ||
                Vector3.Distance(player.transform.position, transform.position) > 6f)
            {
                return;
            }

            if (kind == Kind.Portal)
            {
                player.TeleportOwnerServer(travelDestination);
                return;
            }

            var economy = WorldForgeRegionalEconomy.Current;
            var round = WorldForgeRoundDirector.Current;
            if (economy == null || round == null || !round.IsRoundActive)
            {
                return;
            }

            if (kind == Kind.Mine &&
                !HasRequiredMiningAccess(economy, player.OwnerClientId))
            {
                player.SetOwnerNoticeServer(
                    accessId >= 4
                        ? "GOLD PICKAXE REQUIRED"
                        : "IRON PICKAXE REQUIRED");
                return;
            }

            if (kind == Kind.FarmPlotClaim)
            {
                if (claimedSession.Value != round.SessionNumber)
                {
                    claimedSession.Value = round.SessionNumber;
                    claimedBy.Value = ulong.MaxValue;
                }

                if (claimedBy.Value == player.OwnerClientId)
                {
                    player.TeleportOwnerServer(travelDestination);
                    return;
                }

                if (claimedBy.Value != ulong.MaxValue)
                {
                    player.SetOwnerNoticeServer("THAT PLOT IS TAKEN");
                    return;
                }

                var inventory = player.GetComponent<WorldForgeHotbarInventory>();
                var selected = inventory != null ? inventory.GetSelectedStack() : default;
                if (inventory == null || selected.ItemId.ToString() != "Farm Deed" ||
                    !inventory.TryRemoveServer("Farm Deed", 1))
                {
                    player.SetOwnerNoticeServer("SELECT A FARM DEED");
                    return;
                }

                claimedBy.Value = player.OwnerClientId;
                claimedSession.Value = round.SessionNumber;
                economy.GrantAccessServer(
                    player.OwnerClientId,
                    accessId,
                    $"compact-farm-plot-{accessId}");
                player.SetOwnerNoticeServer($"{displayName} CLAIMED");
                return;
            }

            if (kind == Kind.ShopUpgrade)
            {
                if (economy.HasAccess(player.OwnerClientId, accessId))
                {
                    player.SetOwnerNoticeServer("YOU ALREADY OWN THIS UPGRADE");
                    return;
                }

                if (!economy.TrySpendServer(
                        player.OwnerClientId,
                        WorldForgeRegionalEconomy.Resource.Cash,
                        purchaseCost,
                        WorldForgeRegionalEconomy.Resource.RawMaterial,
                        0,
                        WorldForgeRegionalEconomy.Resource.Provisions,
                        0,
                        $"compact-shop-{accessId}"))
                {
                    player.SetOwnerNoticeServer($"NEED ${purchaseCost}");
                    return;
                }

                economy.GrantAccessServer(
                    player.OwnerClientId,
                    accessId,
                    $"compact-shop-{accessId}");
                player.SetOwnerNoticeServer("UPGRADE PURCHASED");
                return;
            }

            if (kind == Kind.Farm &&
                !economy.HasAccess(player.OwnerClientId, accessId))
            {
                player.SetOwnerNoticeServer("THIS IS NOT YOUR FARM PLOT");
                return;
            }

            if (kind == Kind.Farm && farmStage.Value == 0)
            {
                var inventory = player.GetComponent<WorldForgeHotbarInventory>();
                var crop = SelectedCrop(player);
                var seedItemId = crop == WorldForgeFarmCatalog.Crop.None
                    ? string.Empty
                    : crop + " Seeds";
                if (inventory == null || crop == WorldForgeFarmCatalog.Crop.None ||
                    !inventory.TryRemoveServer(seedItemId, 1))
                {
                    player.SetOwnerNoticeServer("SELECT SEEDS");
                    return;
                }

                farmStage.Value = 1;
                plantedCrop.Value = (byte)crop;
                farmSession.Value = round.SessionNumber;
                readyAt.Value =
                    NetworkManager.ServerTime.Time +
                    WorldForgeFarmCatalog.Get(crop).GrowthSeconds;
                player.SetOwnerNoticeServer($"{WorldForgeFarmCatalog.Get(crop).DisplayName} PLANTED");
                return;
            }

            if (!IsReady())
            {
                return;
            }

            if (kind == Kind.Farm)
            {
                var inventory = player.GetComponent<WorldForgeHotbarInventory>();
                var crop = (WorldForgeFarmCatalog.Crop)plantedCrop.Value;
                var definition = WorldForgeFarmCatalog.Get(crop);
                var produceItemId = WorldForgeFarmDirector.ProduceItemId(crop);
                if (inventory == null || crop == WorldForgeFarmCatalog.Crop.None ||
                    !inventory.TryAddServer(produceItemId, definition.HarvestYield))
                {
                    player.SetOwnerNoticeServer("INVENTORY IS FULL");
                    return;
                }

                farmStage.Value = 0;
                plantedCrop.Value = 0;
                readyAt.Value = 0d;
                var score = definition.HarvestYield * definition.BaseSalePrice;
                player.SetOwnerNoticeServer($"+{definition.HarvestYield} {definition.DisplayName}");
                round.AwardScoreServer(player.OwnerClientId, score, "compact-farm-harvest");
                WorldForgeCompactCompetitionDirector.Current?.NotifyActivityServer(
                    player.OwnerClientId,
                    WorldForgeCompactCompetitionDirector.Route.Farming,
                    score,
                    "compact-farm-harvest");
                return;
            }

            if (kind is Kind.Mine or Kind.Forage)
            {
                var inventory =
                    player.GetComponent<WorldForgeHotbarInventory>();
                var itemId = GetPhysicalItemId();
                if (inventory == null ||
                    !inventory.TryAddServer(itemId, 1))
                {
                    player.SetOwnerNoticeServer("HOTBAR IS FULL");
                    return;
                }

                readyAt.Value =
                    NetworkManager.ServerTime.Time +
                    GetEffectiveCooldown(player.OwnerClientId);
                player.SetOwnerNoticeServer($"+1 {itemId}");
                return;
            }

            var reward = GetReward(player.OwnerClientId);
            var rewardSource = kind switch
            {
                Kind.Mine => "compact-mine",
                Kind.Forage => "compact-forage",
                _ => "compact-farm"
            };
            economy.CreditServer(
                player.OwnerClientId,
                WorldForgeRegionalEconomy.Resource.Cash,
                reward,
                rewardSource);
            if (kind == Kind.Farm)
            {
                farmStage.Value = 0;
                readyAt.Value = 0d;
            }
            else
            {
                readyAt.Value =
                    NetworkManager.ServerTime.Time +
                    GetEffectiveCooldown(player.OwnerClientId);
            }
            player.SetOwnerNoticeServer($"+${reward}");
            round.AwardScoreServer(
                player.OwnerClientId,
                reward,
                rewardSource);
            var route = kind switch
            {
                Kind.Mine =>
                    WorldForgeCompactCompetitionDirector.Route.Mining,
                Kind.Forage =>
                    WorldForgeCompactCompetitionDirector.Route.Foraging,
                _ => WorldForgeCompactCompetitionDirector.Route.Farming
            };
            WorldForgeCompactCompetitionDirector.Current?
                .NotifyActivityServer(
                    player.OwnerClientId,
                    route,
                    reward,
                    rewardSource);
        }

        private static WorldForgeFarmCatalog.Crop SelectedCrop(WorldForgePlayer player)
        {
            var inventory = player != null
                ? player.GetComponent<WorldForgeHotbarInventory>()
                : null;
            var itemId = inventory != null
                ? inventory.GetSelectedStack().ItemId.ToString()
                : string.Empty;
            for (var index = 0; index < WorldForgeFarmCatalog.CropCount; index++)
            {
                var crop = WorldForgeFarmCatalog.FromIndex(index);
                if (string.Equals(itemId, crop + " Seeds", System.StringComparison.Ordinal))
                {
                    return crop;
                }
            }

            return WorldForgeFarmCatalog.Crop.None;
        }

        private string GetPhysicalItemId()
        {
            if (kind == Kind.Mine)
            {
                return accessId >= 4
                    ? "Crystal Ore"
                    : accessId >= 1
                        ? "Rich Ore"
                        : "Stone Ore";
            }

            return cashValue >= 8
                ? "Rare Forage"
                : "Wild Herbs";
        }

        private bool HasCurrentClaim
        {
            get
            {
                var round = WorldForgeRoundDirector.Current;
                return round != null &&
                       claimedSession.Value == round.SessionNumber &&
                       claimedBy.Value != ulong.MaxValue;
            }
        }

        public static bool TryTransferFarmClaimServer(
            int transferredAccessId,
            ulong sellerClientId,
            ulong buyerClientId)
        {
            if (!FarmClaims.TryGetValue(
                    transferredAccessId,
                    out var claim) ||
                !claim.IsServer ||
                claim.claimedBy.Value != sellerClientId)
            {
                return false;
            }

            claim.claimedBy.Value = buyerClientId;
            return true;
        }

        public static bool IsFarmClaimOwnedBy(
            int checkedAccessId,
            ulong clientId)
        {
            return FarmClaims.TryGetValue(checkedAccessId, out var claim) &&
                   claim.claimedBy.Value == clientId;
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
