using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeFarmBed :
        NetworkBehaviour,
        IWorldForgeInteractable
    {
        [SerializeField] private int plotAccessId = 8;
        [SerializeField] private int bedId;
        [SerializeField] private GameObject[] cropStagePrefabs;
        [SerializeField] private float cropVisualScale = 1f;
        [SerializeField] private AudioClip workClip;

        private readonly NetworkVariable<byte> plantedCrop = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<ulong> plantedBy = new(
            ulong.MaxValue,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> plantedSession = new(
            -1,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<double> plantedAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<double> readyAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<byte> remainingHarvests = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        private GameObject activeVisual;
        private int visibleKey = int.MinValue;
        private AudioSource workAudio;

        public void Configure(
            int newPlotAccessId,
            int newBedId,
            GameObject[] newCropStagePrefabs,
            float newCropVisualScale,
            AudioClip newWorkClip = null)
        {
            plotAccessId = newPlotAccessId;
            bedId = newBedId;
            cropStagePrefabs = newCropStagePrefabs;
            cropVisualScale = Mathf.Max(0.05f, newCropVisualScale);
            workClip = newWorkClip;
        }

        private void Awake()
        {
            workAudio = gameObject.AddComponent<AudioSource>();
            workAudio.playOnAwake = false;
            workAudio.spatialBlend = .45f;
            workAudio.minDistance = 1f;
            workAudio.maxDistance = 11f;
            workAudio.dopplerLevel = 0f;
        }

        public override void OnNetworkSpawn()
        {
            plantedCrop.OnValueChanged += OnCropChanged;
            readyAt.OnValueChanged += OnTimingChanged;
            remainingHarvests.OnValueChanged += OnHarvestCountChanged;
            RefreshVisual(true);
        }

        public override void OnNetworkDespawn()
        {
            plantedCrop.OnValueChanged -= OnCropChanged;
            readyAt.OnValueChanged -= OnTimingChanged;
            remainingHarvests.OnValueChanged -= OnHarvestCountChanged;
        }

        private void Update()
        {
            var round = WorldForgeRoundDirector.Current;
            if (IsServer && round != null &&
                plantedSession.Value != round.SessionNumber &&
                plantedCrop.Value != 0)
            {
                ClearBedServer();
            }

            RefreshVisual(false);
        }

        public string GetPrompt(WorldForgePlayer player)
        {
            if (player == null)
            {
                return string.Empty;
            }

            var round = WorldForgeRoundDirector.Current;
            if (round == null || !round.IsRoundActive)
            {
                return string.Empty;
            }

            var economy = WorldForgeRegionalEconomy.Current;
            if (economy == null ||
                !economy.HasAccess(player.OwnerClientId, plotAccessId))
            {
                return WorldForgeLocalization.Text("BUY THIS FARM DEED IN THE PLAZA", "광장에서 이 밭의 권리를 구매하세요");
            }

            var farm = WorldForgeFarmDirector.Current;
            if ((WorldForgeFarmCatalog.Crop)plantedCrop.Value ==
                WorldForgeFarmCatalog.Crop.None)
            {
                if (farm == null)
                {
                    return WorldForgeLocalization.Text("FARM MARKET IS OPENING", "농장 상점 준비 중");
                }

                var selected = farm.GetSelectedCrop(player.OwnerClientId);
                var definition = WorldForgeFarmCatalog.Get(selected);
                var seeds = farm.GetSeedCount(player.OwnerClientId, selected);
                return seeds > 0
                    ? WorldForgeLocalization.Text(
                        $"PLANT {definition.DisplayName}  ({seeds} LEFT)",
                        $"{definition.DisplayName} 심기  ({seeds}개 남음)")
                    : WorldForgeLocalization.Text(
                        "BUY OR SELECT SEEDS AT THE STALL",
                        "농장 상점에서 씨앗을 사거나 선택하세요");
            }

            var crop = (WorldForgeFarmCatalog.Crop)plantedCrop.Value;
            var cropName = WorldForgeFarmCatalog.Get(crop).DisplayName;
            if (IsReady)
            {
                return WorldForgeLocalization.Text($"HARVEST {cropName}", $"{cropName} 수확");
            }

            return WorldForgeLocalization.Text(
                $"{cropName}  {GrowthPercent}%",
                $"{cropName} 성장 중  {GrowthPercent}%");
        }

        public void Interact(WorldForgePlayer player)
        {
            if (player == null || !player.IsOwner || !IsSpawned)
            {
                return;
            }

            RequestUseRpc(player.NetworkObjectId);
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

            var round = WorldForgeRoundDirector.Current;
            var economy = WorldForgeRegionalEconomy.Current;
            var farm = WorldForgeFarmDirector.Current;
            if (round == null || !round.IsRoundActive ||
                economy == null || farm == null ||
                !economy.HasAccess(player.OwnerClientId, plotAccessId))
            {
                return;
            }

            var crop = (WorldForgeFarmCatalog.Crop)plantedCrop.Value;
            if (crop == WorldForgeFarmCatalog.Crop.None)
            {
                if (!farm.TryConsumeSelectedSeedServer(
                        player.OwnerClientId,
                        out crop))
                {
                    player.SetOwnerNoticeServer(
                        "BUY OR SELECT SEEDS AT THE FARM STALL");
                    return;
                }

                var definition = WorldForgeFarmCatalog.Get(crop);
                var duration = definition.GrowthSeconds;
                if (economy.HasAccess(player.OwnerClientId, 6))
                {
                    duration *= 0.58f;
                }
                else if (economy.HasAccess(player.OwnerClientId, 3))
                {
                    duration *= 0.78f;
                }

                var now = NetworkManager.ServerTime.Time;
                plantedCrop.Value = (byte)crop;
                plantedBy.Value = player.OwnerClientId;
                plantedSession.Value = round.SessionNumber;
                plantedAt.Value = now;
                readyAt.Value = now + Mathf.Max(8f, duration);
                remainingHarvests.Value =
                    (byte)Mathf.Clamp(definition.BonusHarvests + 1, 1, 8);
                PlayWorkRpc();
                player.SetOwnerNoticeServer(
                    $"{definition.DisplayName} PLANTED");
                return;
            }

            if (!IsReady)
            {
                return;
            }

            var cropDefinition = WorldForgeFarmCatalog.Get(crop);
            var yield = cropDefinition.HarvestYield;
            if (economy.HasAccess(player.OwnerClientId, 6))
            {
                yield += 2;
            }
            else if (economy.HasAccess(player.OwnerClientId, 3))
            {
                yield += 1;
            }

            if (!farm.CreditHarvestServer(player, crop, yield))
            {
                return;
            }
            PlayWorkRpc();
            if (remainingHarvests.Value > 1)
            {
                remainingHarvests.Value--;
                var regrowTime = Mathf.Max(
                    7f,
                    cropDefinition.GrowthSeconds * 0.42f);
                plantedAt.Value = NetworkManager.ServerTime.Time;
                readyAt.Value = plantedAt.Value + regrowTime;
            }
            else
            {
                ClearBedServer();
            }
        }

        [Rpc(SendTo.Everyone)]
        private void PlayWorkRpc()
        {
            if (workAudio == null || workClip == null)
            {
                return;
            }
            workAudio.volume = WorldForge.Core.Runtime.Worlds.WorldForgeAudioDirector.EffectsVolume * .66f;
            workAudio.pitch = UnityEngine.Random.Range(.96f, 1.06f);
            workAudio.PlayOneShot(workClip);
        }

        private bool IsReady =>
            plantedCrop.Value != 0 &&
            NetworkManager != null &&
            NetworkManager.IsListening &&
            NetworkManager.ServerTime.Time >= readyAt.Value;

        private int GrowthPercent
        {
            get
            {
                if (plantedCrop.Value == 0 ||
                    NetworkManager == null ||
                    !NetworkManager.IsListening)
                {
                    return 0;
                }

                var duration = readyAt.Value - plantedAt.Value;
                if (duration <= 0.01d)
                {
                    return 100;
                }

                return Mathf.Clamp(
                    Mathf.RoundToInt(
                        (float)((NetworkManager.ServerTime.Time -
                                 plantedAt.Value) /
                                duration * 100d)),
                    0,
                    100);
            }
        }

        private void ClearBedServer()
        {
            plantedCrop.Value = 0;
            plantedBy.Value = ulong.MaxValue;
            plantedSession.Value = -1;
            plantedAt.Value = 0d;
            readyAt.Value = 0d;
            remainingHarvests.Value = 0;
        }

        private void RefreshVisual(bool force)
        {
            var crop = (WorldForgeFarmCatalog.Crop)plantedCrop.Value;
            var cropIndex = WorldForgeFarmCatalog.ToIndex(crop);
            var stage = cropIndex < 0 ? -1 : Mathf.Clamp(GrowthPercent / 20, 0, 4);
            var key = cropIndex * 10 + stage;
            if (!force && key == visibleKey)
            {
                return;
            }

            visibleKey = key;
            if (activeVisual != null)
            {
                Destroy(activeVisual);
                activeVisual = null;
            }

            if (cropIndex < 0 || stage < 0 ||
                cropStagePrefabs == null ||
                cropStagePrefabs.Length < WorldForgeFarmCatalog.CropCount * 5)
            {
                return;
            }

            var prefab = cropStagePrefabs[cropIndex * 5 + stage];
            if (prefab == null)
            {
                return;
            }

            activeVisual = Instantiate(prefab, transform);
            activeVisual.name = $"{crop} Stage {stage + 1}";
            activeVisual.transform.localPosition = new Vector3(0f, 0.12f, 0f);
            activeVisual.transform.localRotation = Quaternion.identity;
            activeVisual.transform.localScale = Vector3.one * cropVisualScale;
            var cropColor = crop switch
            {
                WorldForgeFarmCatalog.Crop.Lettuce =>
                    new Color(0.31f, 0.78f, 0.24f),
                WorldForgeFarmCatalog.Crop.Mushroom =>
                    new Color(0.84f, 0.48f, 0.22f),
                WorldForgeFarmCatalog.Crop.Pumpkin =>
                    new Color(0.96f, 0.42f, 0.08f),
                WorldForgeFarmCatalog.Crop.Tomato =>
                    new Color(0.88f, 0.16f, 0.12f),
                WorldForgeFarmCatalog.Crop.Watermelon =>
                    new Color(0.16f, 0.61f, 0.23f),
                _ => Color.white
            };
            var propertyBlock = new MaterialPropertyBlock();
            propertyBlock.SetColor("_BaseColor", cropColor);
            propertyBlock.SetColor("_Color", cropColor);
            foreach (var renderer in
                     activeVisual.GetComponentsInChildren<Renderer>(true))
            {
                renderer.SetPropertyBlock(propertyBlock);
            }
            foreach (var collider in activeVisual.GetComponentsInChildren<Collider>())
            {
                collider.enabled = false;
            }
        }

        private void OnCropChanged(byte _, byte __)
        {
            RefreshVisual(true);
        }

        private void OnTimingChanged(double _, double __)
        {
            RefreshVisual(true);
        }

        private void OnHarvestCountChanged(byte _, byte __)
        {
            RefreshVisual(true);
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
