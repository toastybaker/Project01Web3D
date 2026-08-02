using System;
using System.Collections.Generic;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeProject01Shop : NetworkBehaviour, IWorldForgeInteractable
    {
        public enum ShopKind : byte
        {
            General,
            Farm,
            Mine,
            ForageBuyer
        }

        public readonly struct OfferView
        {
            public OfferView(string id, string name, int price, int stock, bool owned, bool soldOut)
            {
                Id = id;
                Name = name;
                Price = price;
                Stock = stock;
                Owned = owned;
                SoldOut = soldOut;
            }

            public string Id { get; }
            public string Name { get; }
            public int Price { get; }
            public int Stock { get; }
            public bool Owned { get; }
            public bool SoldOut { get; }
        }

        public readonly struct SaleView
        {
            public SaleView(string itemId, string name, int unitPrice, int count)
            {
                ItemId = itemId;
                Name = name;
                UnitPrice = unitPrice;
                Count = count;
            }

            public string ItemId { get; }
            public string Name { get; }
            public int UnitPrice { get; }
            public int Count { get; }
        }

        [SerializeField] private ShopKind kind;
        [SerializeField] private string displayName = "SHOP";
        [SerializeField] private bool playerSalesOnly;
        [SerializeField] private float maximumUseDistance = 6f;

        public ShopKind Kind => kind;
        public string DisplayName => displayName;
        public bool IsPlayerSalesOnly => playerSalesOnly || kind == ShopKind.ForageBuyer;

        public void Configure(ShopKind shopKind, string title, bool buysFromPlayer = false)
        {
            kind = shopKind;
            displayName = string.IsNullOrWhiteSpace(title) ? shopKind.ToString() : title.Trim();
            playerSalesOnly = buysFromPlayer;
        }

        public string GetPrompt(WorldForgePlayer player) =>
            WorldForgeRoundDirector.Current != null &&
            WorldForgeRoundDirector.Current.IsRoundActive
                ? WorldForgeLocalization.Text(
                    $"BROWSE {displayName.ToUpperInvariant()}",
                    $"{displayName} 살펴보기")
                : string.Empty;

        public void Interact(WorldForgePlayer player)
        {
            if (player == null || !player.IsOwner || !IsSpawned)
            {
                return;
            }
            WorldForgeGameHUD.RequestOpenShop(this);
        }

        public IReadOnlyList<OfferView> GetOffers(ulong clientId)
        {
            var offers = new List<OfferView>();
            if (IsPlayerSalesOnly) return offers;
            var economy = WorldForgeRegionalEconomy.Current;
            switch (kind)
            {
                case ShopKind.Farm:
                    var farm = WorldForgeFarmDirector.Current;
                    for (var index = 0; index < WorldForgeFarmCatalog.CropCount; index++)
                    {
                        var crop = WorldForgeFarmCatalog.FromIndex(index);
                        var definition = WorldForgeFarmCatalog.Get(crop);
                        var stock = farm?.GetSeedStock(crop) ?? 0;
                        offers.Add(new OfferView(
                            $"seed:{index}",
                            $"{definition.DisplayName} Seeds",
                            definition.SeedCost,
                            stock,
                            false,
                            stock <= 0));
                    }
                    var availablePlots = 0;
                    for (var accessId = 8; accessId < 16; accessId++)
                    {
                        if (!IsDeedOwned(accessId)) availablePlots++;
                    }
                    offers.Add(new OfferView("deed", "Farm Deed", 130, availablePlots,
                        false, availablePlots <= 0));
                    break;

                case ShopKind.Mine:
                    offers.Add(ToolOffer(clientId, "Iron Pickaxe", 85));
                    offers.Add(ToolOffer(clientId, "Gold Pickaxe", 310));
                    break;

                case ShopKind.General:
                    offers.Add(new OfferView("item:Water Can", "Water Can", 28, -1,
                        HasItem(clientId, "Water Can"), false));
                    offers.Add(new OfferView("item:Harvest Pack", "Harvest Pack", 110, -1,
                        HasItem(clientId, "Harvest Pack"), false));
                    break;
            }
            return offers;
        }

        public IReadOnlyList<SaleView> GetSaleOffers(ulong clientId)
        {
            var sales = new List<SaleView>();
            if (!IsPlayerSalesOnly) return sales;
            var inventory = ResolveInventory(clientId);
            if (inventory == null) return sales;

            var itemIds = new List<string>();
            if (kind == ShopKind.Farm)
            {
                for (var index = 0; index < WorldForgeFarmCatalog.CropCount; index++)
                {
                    itemIds.Add(WorldForgeFarmDirector.ProduceItemId(WorldForgeFarmCatalog.FromIndex(index)));
                }
            }
            else if (kind == ShopKind.Mine)
            {
                itemIds.AddRange(new[] { "Stone Ore", "Rich Ore", "Crystal Ore" });
            }
            else if (kind == ShopKind.ForageBuyer)
            {
                itemIds.AddRange(new[] { "Wild Herbs", "Wild Mushroom", "Rare Forage" });
            }

            foreach (var itemId in itemIds)
            {
                sales.Add(new SaleView(itemId, WorldForgeProject01Rules.DisplayItemName(itemId),
                    SalePrice(itemId), inventory.GetTotalCount(itemId)));
            }
            return sales;
        }

        public void RequestBuy(string offerId, int quantity)
        {
            var player = NetworkManager.Singleton?.SpawnManager.GetLocalPlayerObject()
                ?.GetComponent<WorldForgePlayer>();
            if (player == null || !IsSpawned || string.IsNullOrWhiteSpace(offerId))
            {
                return;
            }
            RequestBuyRpc(player.NetworkObjectId, new FixedString64Bytes(offerId), Mathf.Clamp(quantity, 1, 10));
        }

        public void RequestSellSelected(bool sellAll)
        {
            var player = NetworkManager.Singleton?.SpawnManager.GetLocalPlayerObject()
                ?.GetComponent<WorldForgePlayer>();
            if (player == null || !IsSpawned)
            {
                return;
            }
            RequestSellRpc(player.NetworkObjectId, sellAll);
        }

        public void RequestSellItem(string itemId, bool sellAll)
        {
            var player = NetworkManager.Singleton?.SpawnManager.GetLocalPlayerObject()
                ?.GetComponent<WorldForgePlayer>();
            if (player == null || !IsSpawned || string.IsNullOrWhiteSpace(itemId)) return;
            RequestSellItemRpc(player.NetworkObjectId, new FixedString64Bytes(itemId), sellAll);
        }

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void RequestSellItemRpc(
            ulong playerObjectId,
            FixedString64Bytes requestedItem,
            bool sellAll,
            RpcParams rpcParams = default)
        {
            if (!TryResolvePlayer(playerObjectId, rpcParams.Receive.SenderClientId, out var player) ||
                Vector3.Distance(player.transform.position, transform.position) > maximumUseDistance ||
                WorldForgeRoundDirector.Current == null || !WorldForgeRoundDirector.Current.IsRoundActive)
            {
                return;
            }

            var itemId = requestedItem.ToString();
            if (!AcceptsSale(itemId)) return;
            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            var economy = WorldForgeRegionalEconomy.Current;
            var count = inventory?.GetTotalCount(itemId) ?? 0;
            var unitPrice = SalePrice(itemId);
            if (inventory == null || economy == null || count <= 0 || unitPrice <= 0) return;
            var amount = sellAll ? count : 1;
            if (!inventory.TryRemoveServer(itemId, amount)) return;
            var total = unitPrice * amount;
            economy.CreditServer(player.OwnerClientId, WorldForgeRegionalEconomy.Resource.Cash, total, "shop-sale");
            WorldForgeRoundDirector.Current.AwardScoreServer(player.OwnerClientId, total, "shop-sale");
            player.SetOwnerNoticeServer($"Sold {amount} for {WorldForgeProject01Rules.Money(total)}");
        }

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void RequestBuyRpc(
            ulong playerObjectId,
            FixedString64Bytes offerId,
            int quantity,
            RpcParams rpcParams = default)
        {
            if (!TryResolvePlayer(playerObjectId, rpcParams.Receive.SenderClientId, out var player) ||
                Vector3.Distance(player.transform.position, transform.position) > maximumUseDistance ||
                WorldForgeRoundDirector.Current == null || !WorldForgeRoundDirector.Current.IsRoundActive)
            {
                return;
            }

            var id = offerId.ToString();
            if (id.StartsWith("seed:", StringComparison.Ordinal) && kind == ShopKind.Farm &&
                int.TryParse(id[5..], out var cropIndex))
            {
                var crop = WorldForgeFarmCatalog.FromIndex(cropIndex);
                for (var count = 0; count < quantity; count++)
                {
                    if (!(WorldForgeFarmDirector.Current?.TryBuySeedPackServer(player, crop) ?? false))
                    {
                        break;
                    }
                }
                return;
            }

            if (id.StartsWith("deed:", StringComparison.Ordinal) && kind == ShopKind.Farm &&
                int.TryParse(id[5..], out var plotIndex))
            {
                BuyDeedServer(player, Mathf.Clamp(plotIndex, 0, 7));
                return;
            }

            if (id == "deed" && kind == ShopKind.Farm)
            {
                BuyPhysicalItemServer(player, "Farm Deed", 130, false);
                return;
            }

            if (id.StartsWith("tool:", StringComparison.Ordinal) && kind == ShopKind.Mine)
            {
                var tool = id[5..];
                BuyToolUpgradeServer(player, tool, tool == "Gold Pickaxe" ? 310 : 85);
                return;
            }

            if (id.StartsWith("item:", StringComparison.Ordinal) && kind == ShopKind.General)
            {
                var item = id[5..];
                BuyPhysicalItemServer(player, item, item == "Harvest Pack" ? 110 : 28, true);
            }
        }

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void RequestSellRpc(
            ulong playerObjectId,
            bool sellAll,
            RpcParams rpcParams = default)
        {
            if (!TryResolvePlayer(playerObjectId, rpcParams.Receive.SenderClientId, out var player) ||
                Vector3.Distance(player.transform.position, transform.position) > maximumUseDistance ||
                WorldForgeRoundDirector.Current == null || !WorldForgeRoundDirector.Current.IsRoundActive)
            {
                return;
            }

            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            var economy = WorldForgeRegionalEconomy.Current;
            if (inventory == null || economy == null)
            {
                return;
            }

            var selected = inventory.GetSelectedStack();
            var itemId = selected.ItemId.ToString();
            var unitPrice = SalePrice(itemId);
            if (selected.IsEmpty || unitPrice <= 0)
            {
                player.SetOwnerNoticeServer("Select something this buyer accepts.");
                return;
            }

            var amount = sellAll ? selected.Count : 1;
            if (!inventory.TryRemoveServer(itemId, amount))
            {
                return;
            }
            var total = unitPrice * amount;
            economy.CreditServer(player.OwnerClientId, WorldForgeRegionalEconomy.Resource.Cash, total, "shop-sale");
            WorldForgeRoundDirector.Current.AwardScoreServer(player.OwnerClientId, total, "shop-sale");
            player.SetOwnerNoticeServer($"Sold {amount} for {WorldForgeProject01Rules.Money(total)}");
        }

        private void BuyDeedServer(WorldForgePlayer player, int plotIndex)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            var accessId = 8 + plotIndex;
            var price = 130 + plotIndex * 15;
            if (economy == null || economy.HasAccess(player.OwnerClientId, accessId))
            {
                player.SetOwnerNoticeServer(WorldForgeLocalization.Text("You already own that deed.", "이미 보유한 밭입니다."));
                return;
            }
            if (IsDeedOwned(accessId))
            {
                player.SetOwnerNoticeServer(WorldForgeLocalization.Text("That deed has been claimed.", "이미 다른 플레이어가 가져간 밭입니다."));
                return;
            }
            if (!economy.TryDebitServer(player.OwnerClientId, WorldForgeRegionalEconomy.Resource.Cash, price, "farm-deed"))
            {
                player.SetOwnerNoticeServer(WorldForgeLocalization.Text(
                    $"Need {WorldForgeProject01Rules.Money(price)}",
                    $"{WorldForgeProject01Rules.Money(price)} 필요"));
                return;
            }
            economy.GrantAccessServer(player.OwnerClientId, accessId, "farm-deed");
            player.SetOwnerNoticeServer(WorldForgeLocalization.Text(
                $"Farm {plotIndex + 1} is yours.",
                $"{plotIndex + 1}번 밭을 구매했습니다."));
        }

        private static void BuyPhysicalItemServer(WorldForgePlayer player, string itemId, int price, bool unique)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            if (economy == null || inventory == null)
            {
                return;
            }
            if (unique && inventory.GetTotalCount(itemId) > 0)
            {
                player.SetOwnerNoticeServer("Already owned.");
                return;
            }
            if (!inventory.CanAdd(itemId, 1))
            {
                player.SetOwnerNoticeServer("Hotbar full.");
                return;
            }
            if (!economy.TryDebitServer(player.OwnerClientId, WorldForgeRegionalEconomy.Resource.Cash, price, "shop-buy"))
            {
                player.SetOwnerNoticeServer($"Need {WorldForgeProject01Rules.Money(price)}");
                return;
            }
            if (!inventory.TryAddServer(itemId, 1))
            {
                economy.CreditServer(
                    player.OwnerClientId,
                    WorldForgeRegionalEconomy.Resource.Cash,
                    price,
                    "shop-buy-refund");
                player.SetOwnerNoticeServer("Purchase could not be delivered.");
                return;
            }
            player.SetOwnerNoticeServer($"Bought {itemId}.");
        }

        private static void BuyToolUpgradeServer(
            WorldForgePlayer player,
            string tool,
            int price)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            var inventory = player.GetComponent<WorldForgeHotbarInventory>();
            if (economy == null || inventory == null)
            {
                return;
            }

            if (inventory.GetTotalCount(tool) > 0)
            {
                player.SetOwnerNoticeServer("Already owned.");
                return;
            }

            var previous = tool == "Gold Pickaxe" &&
                           inventory.GetTotalCount("Iron Pickaxe") > 0
                ? "Iron Pickaxe"
                : "Worn Pickaxe";
            if (inventory.GetTotalCount(previous) <= 0)
            {
                previous = string.Empty;
            }
            if (string.IsNullOrEmpty(previous) && !inventory.CanAdd(tool, 1, 1))
            {
                player.SetOwnerNoticeServer("Hotbar full.");
                return;
            }
            if (!economy.TryDebitServer(
                    player.OwnerClientId,
                    WorldForgeRegionalEconomy.Resource.Cash,
                    price,
                    "pickaxe-upgrade"))
            {
                player.SetOwnerNoticeServer($"Need {WorldForgeProject01Rules.Money(price)}");
                return;
            }

            if (!inventory.TryReplaceToolServer(previous, tool))
            {
                economy.CreditServer(
                    player.OwnerClientId,
                    WorldForgeRegionalEconomy.Resource.Cash,
                    price,
                    "pickaxe-upgrade-refund");
                player.SetOwnerNoticeServer("Could not equip that pickaxe.");
                return;
            }
            player.SetOwnerNoticeServer($"Upgraded to {tool}.");
        }

        private static int SalePrice(string itemId)
        {
            if (string.IsNullOrWhiteSpace(itemId)) return 0;
            if (itemId == "Stone Ore") return Demand(WorldForgeCompactInteractable.Kind.Mine, 4);
            if (itemId == "Rich Ore") return Demand(WorldForgeCompactInteractable.Kind.Mine, 9);
            if (itemId == "Crystal Ore") return Demand(WorldForgeCompactInteractable.Kind.Mine, 18);
            if (itemId == "Wild Herbs") return Demand(WorldForgeCompactInteractable.Kind.Forage, 4);
            if (itemId == "Wild Mushroom") return Demand(WorldForgeCompactInteractable.Kind.Forage, 5);
            if (itemId == "Rare Forage") return Demand(WorldForgeCompactInteractable.Kind.Forage, 13);
            for (var index = 0; index < WorldForgeFarmCatalog.CropCount; index++)
            {
                var crop = WorldForgeFarmCatalog.FromIndex(index);
                if (itemId == WorldForgeFarmDirector.ProduceItemId(crop))
                {
                    return WorldForgeFarmDirector.Current?.GetMarketPrice(crop) ??
                           WorldForgeFarmCatalog.Get(crop).BaseSalePrice;
                }
            }
            return 0;
        }

        private static int Demand(WorldForgeCompactInteractable.Kind kind, int price) =>
            WorldForgeCompactMarketDirector.Current?.ApplyDemand(kind, price) ?? price;

        private bool AcceptsSale(string itemId)
        {
            if (kind == ShopKind.Mine) return itemId is "Stone Ore" or "Rich Ore" or "Crystal Ore";
            if (kind == ShopKind.ForageBuyer) return itemId is "Wild Herbs" or "Wild Mushroom" or "Rare Forage";
            if (kind != ShopKind.Farm) return false;
            for (var index = 0; index < WorldForgeFarmCatalog.CropCount; index++)
            {
                if (itemId == WorldForgeFarmDirector.ProduceItemId(WorldForgeFarmCatalog.FromIndex(index))) return true;
            }
            return false;
        }

        private static bool IsDeedOwned(int accessId)
        {
            var economy = WorldForgeRegionalEconomy.Current;
            if (economy == null) return false;
            foreach (var state in economy.PlayerStates)
            {
                if ((state.AccessMask & (1u << accessId)) != 0) return true;
            }
            return false;
        }

        private static OfferView ToolOffer(ulong clientId, string name, int price) =>
            new($"tool:{name}", name, price, -1, HasItem(clientId, name), false);

        private static bool HasItem(ulong clientId, string itemId)
        {
            if (NetworkManager.Singleton == null ||
                !NetworkManager.Singleton.ConnectedClients.TryGetValue(clientId, out var client) ||
                client.PlayerObject == null)
            {
                return false;
            }
            return client.PlayerObject.GetComponent<WorldForgeHotbarInventory>()?.GetTotalCount(itemId) > 0;
        }

        private static WorldForgeHotbarInventory ResolveInventory(ulong clientId)
        {
            if (NetworkManager.Singleton == null ||
                !NetworkManager.Singleton.ConnectedClients.TryGetValue(clientId, out var client) ||
                client.PlayerObject == null) return null;
            return client.PlayerObject.GetComponent<WorldForgeHotbarInventory>();
        }

        private bool TryResolvePlayer(ulong objectId, ulong senderId, out WorldForgePlayer player)
        {
            player = null;
            if (NetworkManager == null || NetworkManager.SpawnManager == null ||
                !NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(objectId, out var networkObject) ||
                networkObject.OwnerClientId != senderId)
            {
                return false;
            }
            player = networkObject.GetComponent<WorldForgePlayer>();
            return player != null;
        }
    }
}
