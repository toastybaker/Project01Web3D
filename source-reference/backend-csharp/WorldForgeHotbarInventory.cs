using System;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;
using WorldForge.Core.Networking;
using WorldForge.Core.Runtime.Worlds;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeHotbarInventory : NetworkBehaviour
    {
        public const int SlotCount = 9;
        public const int InventorySlotCount = 36;
        public const int DefaultMaximumStack = 99;
        public const string RecallItemId = "Waystone";

        public struct ItemStack :
            INetworkSerializable,
            IEquatable<ItemStack>
        {
            public FixedString32Bytes ItemId;
            public ushort Count;

            public ItemStack(string itemId, int count)
            {
                ItemId = new FixedString32Bytes(
                    string.IsNullOrWhiteSpace(itemId) ? string.Empty : itemId);
                Count = (ushort)Mathf.Clamp(count, 0, ushort.MaxValue);
            }

            public bool IsEmpty => Count == 0 || ItemId.IsEmpty;

            public void NetworkSerialize<T>(BufferSerializer<T> serializer)
                where T : IReaderWriter
            {
                serializer.SerializeValue(ref ItemId);
                serializer.SerializeValue(ref Count);
            }

            public bool Equals(ItemStack other)
            {
                return ItemId.Equals(other.ItemId) && Count == other.Count;
            }
        }

        private NetworkList<ItemStack> slots;
        private int selectedSlot;

        public int SelectedSlot => selectedSlot;
        public NetworkList<ItemStack> Slots => slots;
        public event Action SelectionChanged;

        private void Awake()
        {
            slots = new NetworkList<ItemStack>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
        }

        public override void OnNetworkSpawn()
        {
            if (IsServer)
            {
                EnsureSlotCount();
                if (GetTotalCount("Worn Pickaxe") == 0)
                {
                    TryAddServer("Worn Pickaxe", 1, 1);
                }
                EnsureRecallItemServer();
            }
        }

        public override void OnDestroy()
        {
            slots?.Dispose();
            base.OnDestroy();
        }

        private void Update()
        {
            if (!IsOwner || !IsSpawned)
            {
                return;
            }

            var modalOpen = WorldForge.Core.Networking.WorldForgeGameHUD.IsModalOpen;

            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                for (var index = 0; index < SlotCount; index++)
                {
                    if (keyboard[(Key)((int)Key.Digit1 + index)].wasPressedThisFrame)
                    {
                        SelectSlot(index);
                        break;
                    }
                }
            }

            var mouse = Mouse.current;
            if (mouse == null)
            {
                return;
            }

            var scroll = mouse.scroll.ReadValue().y;
            if (Mathf.Abs(scroll) > 0.01f)
            {
                SelectSlot(
                    (selectedSlot + (scroll > 0f ? -1 : 1) + SlotCount) %
                    SlotCount);
            }

            if (!modalOpen && mouse.rightButton.wasPressedThisFrame &&
                GetSelectedStack().ItemId.ToString() == RecallItemId)
            {
                RequestRecallRpc();
            }
        }

        public ItemStack GetSlot(int index)
        {
            return slots != null && index >= 0 && index < slots.Count
                ? slots[index]
                : default;
        }

        public ItemStack GetSelectedStack()
        {
            return GetSlot(selectedSlot);
        }

        public void SelectSlot(int index)
        {
            var next = Mathf.Clamp(index, 0, SlotCount - 1);
            if (next == selectedSlot)
            {
                return;
            }

            selectedSlot = next;
            SelectionChanged?.Invoke();
        }

        public bool CanAdd(string itemId, int amount, int maximumStack = DefaultMaximumStack)
        {
            if (string.IsNullOrWhiteSpace(itemId) || amount <= 0)
            {
                return false;
            }

            var remainingCapacity = 0;
            for (var index = 0; index < slots.Count; index++)
            {
                var slot = slots[index];
                if (slot.IsEmpty)
                {
                    remainingCapacity += maximumStack;
                }
                else if (slot.ItemId.ToString() == itemId)
                {
                    remainingCapacity += Mathf.Max(0, maximumStack - slot.Count);
                }
            }

            return remainingCapacity >= amount;
        }

        public bool TryAddServer(
            string itemId,
            int amount,
            int maximumStack = DefaultMaximumStack)
        {
            if (!IsServer ||
                !CanAdd(itemId, amount, maximumStack))
            {
                return false;
            }

            var remaining = amount;
            for (var index = 0; index < slots.Count && remaining > 0; index++)
            {
                var slot = slots[index];
                if (slot.IsEmpty || slot.ItemId.ToString() != itemId)
                {
                    continue;
                }

                var moved = Mathf.Min(remaining, maximumStack - slot.Count);
                slot.Count += (ushort)moved;
                slots[index] = slot;
                remaining -= moved;
            }

            for (var index = 0; index < slots.Count && remaining > 0; index++)
            {
                if (!slots[index].IsEmpty)
                {
                    continue;
                }

                var moved = Mathf.Min(remaining, maximumStack);
                slots[index] = new ItemStack(itemId, moved);
                remaining -= moved;
            }

            return remaining == 0;
        }

        public bool TryRemoveServer(string itemId, int amount)
        {
            if (!IsServer || string.IsNullOrWhiteSpace(itemId) || amount <= 0)
            {
                return false;
            }

            if (string.Equals(itemId, RecallItemId, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var available = 0;
            for (var index = 0; index < slots.Count; index++)
            {
                if (slots[index].ItemId.ToString() == itemId)
                {
                    available += slots[index].Count;
                }
            }
            if (available < amount)
            {
                return false;
            }

            var remaining = amount;
            for (var index = slots.Count - 1;
                 index >= 0 && remaining > 0;
                 index--)
            {
                var slot = slots[index];
                if (slot.ItemId.ToString() != itemId)
                {
                    continue;
                }

                var removed = Mathf.Min(remaining, slot.Count);
                slot.Count -= (ushort)removed;
                slots[index] = slot.Count == 0 ? default : slot;
                remaining -= removed;
            }

            return true;
        }

        public int GetTotalCount(string itemId)
        {
            if (slots == null || string.IsNullOrWhiteSpace(itemId))
            {
                return 0;
            }

            var total = 0;
            for (var index = 0; index < slots.Count; index++)
            {
                if (slots[index].ItemId.ToString() == itemId)
                {
                    total += slots[index].Count;
                }
            }
            return total;
        }

        public int RemoveAllServer(string itemId)
        {
            var count = GetTotalCount(itemId);
            return count > 0 && TryRemoveServer(itemId, count)
                ? count
                : 0;
        }

        public bool TryReplaceToolServer(
            string previousItemId,
            string nextItemId)
        {
            if (!IsServer || string.IsNullOrWhiteSpace(nextItemId))
            {
                return false;
            }

            if (!string.IsNullOrWhiteSpace(previousItemId))
            {
                for (var index = 0; index < slots.Count; index++)
                {
                    if (slots[index].ItemId.ToString() != previousItemId)
                    {
                        continue;
                    }

                    slots[index] = new ItemStack(nextItemId, 1);
                    return true;
                }
            }

            return TryAddServer(nextItemId, 1, 1);
        }

        public void ResetForRoundServer()
        {
            if (!IsServer)
            {
                return;
            }

            ClearServer();
            TryAddServer("Worn Pickaxe", 1, 1);
            EnsureRecallItemServer();
        }

        public void ClearServer()
        {
            if (!IsServer)
            {
                return;
            }

            EnsureSlotCount();
            for (var index = 0; index < slots.Count; index++)
            {
                slots[index] = default;
            }
        }

        private void EnsureSlotCount()
        {
            while (slots.Count < InventorySlotCount)
            {
                slots.Add(default);
            }
            while (slots.Count > InventorySlotCount)
            {
                slots.RemoveAt(slots.Count - 1);
            }
        }

        private void EnsureRecallItemServer()
        {
            if (!IsServer)
            {
                return;
            }

            EnsureSlotCount();
            for (var index = 0; index < slots.Count; index++)
            {
                if (slots[index].ItemId.ToString() == RecallItemId)
                {
                    slots[index] = default;
                }
            }
            slots[SlotCount - 1] = new ItemStack(RecallItemId, 1);
        }

        [Rpc(SendTo.Server)]
        private void RequestRecallRpc(RpcParams rpcParams = default)
        {
            if (rpcParams.Receive.SenderClientId != OwnerClientId)
            {
                return;
            }

            var player = GetComponent<WorldForgePlayer>();
            if (player == null)
            {
                return;
            }

            var anchor = WorldForgeTravelAnchor.Find("plaza");
            var fallbackModule = WorldForgeWorldModule.Current;
            var arrival = anchor != null
                ? anchor.ArrivalPosition
                : fallbackModule != null
                    ? fallbackModule.GetSpawnPosition(OwnerClientId)
                    : Vector3.up * 1.05f;
            player.TeleportOwnerServer(arrival);
            player.SetOwnerNoticeServer("Returned to the plaza.");
        }
    }
}
