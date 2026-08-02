using System;
using System.Linq;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using WorldForge.Core.Networking;
using WorldForge.Core.Runtime.Worlds;

namespace WorldForge.Core.Runtime.Gameplay
{
    [RequireComponent(typeof(NetworkObject))]
    public sealed class WorldForgeRoundDirector : NetworkBehaviour
    {
        public const int RegionalRulesVersion = 1;

        public struct PlayerStanding : INetworkSerializable, IEquatable<PlayerStanding>
        {
            public ulong ClientId;
            public int Score;

            public PlayerStanding(ulong clientId, int score)
            {
                ClientId = clientId;
                Score = score;
            }

            public void NetworkSerialize<T>(BufferSerializer<T> serializer)
                where T : IReaderWriter
            {
                serializer.SerializeValue(ref ClientId);
                serializer.SerializeValue(ref Score);
            }

            public bool Equals(PlayerStanding other)
            {
                return ClientId == other.ClientId && Score == other.Score;
            }
        }

        public enum RoundPhase : byte
        {
            Pregame,
            Playing,
            Results
        }

        public static WorldForgeRoundDirector Current { get; private set; }

        private const string CosmeticCurrencyKey = "WorldForge.CosmeticCredits";

        [SerializeField] private string publicMatchName = "Highland Competition";
        [SerializeField] private float roundDurationSeconds = 2400f;
        [SerializeField] private int winnerCosmeticCredits = 25;
        [SerializeField] private int targetScore = 100;
        [SerializeField] private bool scoreVictoryEnabled;

        private readonly NetworkVariable<RoundPhase> phase = new(
            RoundPhase.Pregame,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<double> serverRoundEndsAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<double> serverRoundStartedAt = new(
            0d,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<ulong> winnerClientId = new(
            ulong.MaxValue,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<FixedString128Bytes> resultSummary = new(
            default,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> sessionSeed = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        private readonly NetworkVariable<int> sessionNumber = new(
            0,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        private NetworkList<PlayerStanding> standings;
        private bool localRewardGranted;
        private double nextCashStandingSyncAt;

        public RoundPhase Phase => phase.Value;
        public bool AllowsPlayerAction => phase.Value == RoundPhase.Playing;
        public bool IsRoundActive => phase.Value == RoundPhase.Playing;
        public int TargetScore => targetScore;
        public int SessionSeed => sessionSeed.Value;
        public int SessionNumber => sessionNumber.Value;
        public string PublicMatchName => publicMatchName;
        public ulong WinnerClientId => winnerClientId.Value;
        public string ResultSummary => resultSummary.Value.ToString();
        public int CosmeticCredits =>
            PlayerPrefs.GetInt(CosmeticCurrencyKey, 0);
        public int WinnerCosmeticCredits => winnerCosmeticCredits;
        public int ConfiguredRoundMinutes =>
            Mathf.RoundToInt(roundDurationSeconds / 60f);

        public bool SetRoundDurationMinutesAsHost(int minutes)
        {
            if (!IsServer || phase.Value == RoundPhase.Playing)
            {
                return false;
            }

            roundDurationSeconds = Mathf.Clamp(minutes, 15, 120) * 60f;
            return true;
        }

        public bool TrySpendCosmeticCredits(int amount)
        {
            var cost = Mathf.Max(0, amount);
            var current = CosmeticCredits;
            if (current < cost)
            {
                return false;
            }

            PlayerPrefs.SetInt(CosmeticCurrencyKey, current - cost);
            PlayerPrefs.Save();
            return true;
        }
        public double RoundElapsedSeconds =>
            phase.Value == RoundPhase.Playing && NetworkManager != null
                ? Math.Max(0d, NetworkManager.ServerTime.Time - serverRoundStartedAt.Value)
                : 0d;
        public double RoundRemainingSeconds =>
            phase.Value == RoundPhase.Playing && NetworkManager != null
                ? Math.Max(0d, serverRoundEndsAt.Value - NetworkManager.ServerTime.Time)
                : 0d;
        public NetworkList<PlayerStanding> Standings => standings;

        private void Awake()
        {
            standings = new NetworkList<PlayerStanding>(
                null,
                NetworkVariableReadPermission.Everyone,
                NetworkVariableWritePermission.Server);
            Current = this;
        }

        public override void OnNetworkSpawn()
        {
            Current = this;
            phase.OnValueChanged += OnPhaseChanged;
            NetworkManager.OnClientConnectedCallback += OnClientConnected;
            NetworkManager.OnClientDisconnectCallback += OnClientDisconnected;
            if (IsServer)
            {
                foreach (var clientId in NetworkManager.ConnectedClientsIds)
                {
                    EnsureStanding(clientId);
                }
            }

            Debug.Log($"[WorldForge] WF_ROUND_READY:{phase.Value}:{IsServer}");
        }

        public override void OnNetworkDespawn()
        {
            phase.OnValueChanged -= OnPhaseChanged;
            if (NetworkManager != null)
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
            standings?.Dispose();
            base.OnDestroy();
        }

        private void Update()
        {
            if (IsServer && phase.Value == RoundPhase.Playing && UsesCashStandings &&
                NetworkManager.ServerTime.Time >= nextCashStandingSyncAt)
            {
                nextCashStandingSyncAt = NetworkManager.ServerTime.Time + 0.2d;
                SyncCashStandingsServer();
            }
            if (IsServer && phase.Value == RoundPhase.Playing &&
                NetworkManager.ServerTime.Time >= serverRoundEndsAt.Value)
            {
                if (UsesCashStandings) SyncCashStandingsServer();
                var leader = GetLeadingClient();
                FinishRoundServer(
                    leader,
                    leader == ulong.MaxValue
                        ? "Round complete"
                        : $"Player {leader} led when time expired");
            }

            TryGrantLocalReward();
        }

        public void StartRoundAsHost()
        {
            if (!IsServer || phase.Value == RoundPhase.Playing)
            {
                return;
            }

            winnerClientId.Value = ulong.MaxValue;
            resultSummary.Value = default;
            localRewardGranted = false;
            ResetStandings();
            sessionNumber.Value++;
            sessionSeed.Value = GenerateSessionSeed(sessionNumber.Value);
            serverRoundStartedAt.Value = NetworkManager.ServerTime.Time;
            serverRoundEndsAt.Value =
                serverRoundStartedAt.Value + Mathf.Max(60f, roundDurationSeconds);
            phase.Value = RoundPhase.Playing;
            Debug.Log(
                $"[WorldForge] WF_ROUND_STARTED:{sessionNumber.Value}:{sessionSeed.Value}");
        }

        public void AwardScoreServer(ulong clientId, int amount, string source)
        {
            if (!IsServer || phase.Value != RoundPhase.Playing || amount <= 0)
            {
                return;
            }

            var index = FindStandingIndex(clientId);
            if (index < 0)
            {
                EnsureStanding(clientId);
                index = FindStandingIndex(clientId);
            }

            var updated = standings[index];
            updated.Score = UsesCashStandings && WorldForgeRegionalEconomy.Current != null
                ? WorldForgeRegionalEconomy.Current.GetAmount(
                    clientId, WorldForgeRegionalEconomy.Resource.Cash)
                : updated.Score + amount;
            standings[index] = updated;
            Debug.Log(
                $"[WorldForge] WF_SCORE_AWARDED:{clientId}:{amount}:{updated.Score}:{source}");

            if (scoreVictoryEnabled && updated.Score >= Mathf.Max(1, targetScore))
            {
                FinishRoundServer(
                    clientId,
                    $"Player {clientId} reached {updated.Score} points");
            }
        }

        private bool UsesCashStandings
        {
            get
            {
                var moduleId = WorldForgeWorldModule.Current?.ModuleId;
                return moduleId == "project01-final" ||
                       moduleId == "project01-compact" ||
                       moduleId == "project01-reconstruction";
            }
        }

        private void SyncCashStandingsServer()
        {
            var economy = WorldForgeRegionalEconomy.Current;
            if (!IsServer || economy == null) return;
            foreach (var clientId in NetworkManager.ConnectedClientsIds)
            {
                EnsureStanding(clientId);
                var index = FindStandingIndex(clientId);
                if (index < 0) continue;
                var entry = standings[index];
                var cash = economy.GetAmount(clientId, WorldForgeRegionalEconomy.Resource.Cash);
                if (entry.Score == cash) continue;
                entry.Score = cash;
                standings[index] = entry;
            }
        }

        public int GetScore(ulong clientId)
        {
            var index = FindStandingIndex(clientId);
            return index >= 0 ? standings[index].Score : 0;
        }

        public int GetSessionVariant(string channel, int optionCount)
        {
            if (optionCount <= 1)
            {
                return 0;
            }

            unchecked
            {
                var hash = 2166136261u ^ (uint)sessionSeed.Value;
                if (!string.IsNullOrEmpty(channel))
                {
                    foreach (var character in channel)
                    {
                        hash ^= character;
                        hash *= 16777619u;
                    }
                }

                return (int)(hash % (uint)optionCount);
            }
        }

        public void FinishRoundServer(ulong winner, string summary)
        {
            if (!IsServer || phase.Value != RoundPhase.Playing)
            {
                return;
            }

            winnerClientId.Value = winner;
            resultSummary.Value = string.IsNullOrWhiteSpace(summary)
                ? new FixedString128Bytes("Round complete")
                : new FixedString128Bytes(summary[..Mathf.Min(120, summary.Length)]);
            phase.Value = RoundPhase.Results;
            Debug.Log($"[WorldForge] WF_ROUND_FINISHED:{winner}");
        }

        public void ReturnToPregameAsHost()
        {
            if (!IsServer || phase.Value != RoundPhase.Results)
            {
                return;
            }

            winnerClientId.Value = ulong.MaxValue;
            resultSummary.Value = default;
            serverRoundStartedAt.Value = 0d;
            serverRoundEndsAt.Value = 0d;
            phase.Value = RoundPhase.Pregame;
            Debug.Log("[WorldForge] WF_ROUND_RESET");
        }

        private void OnPhaseChanged(RoundPhase previous, RoundPhase current)
        {
            if (current != RoundPhase.Results)
            {
                localRewardGranted = false;
            }
        }

        private void OnClientConnected(ulong clientId)
        {
            if (IsServer)
            {
                EnsureStanding(clientId);
            }
        }

        private void OnClientDisconnected(ulong clientId)
        {
            if (!IsServer)
            {
                return;
            }

            var index = FindStandingIndex(clientId);
            if (index >= 0)
            {
                standings.RemoveAt(index);
            }
        }

        private void EnsureStanding(ulong clientId)
        {
            if (FindStandingIndex(clientId) < 0)
            {
                standings.Add(new PlayerStanding(clientId, 0));
            }
        }

        private int FindStandingIndex(ulong clientId)
        {
            if (standings == null)
            {
                return -1;
            }

            for (var i = 0; i < standings.Count; i++)
            {
                if (standings[i].ClientId == clientId)
                {
                    return i;
                }
            }

            return -1;
        }

        private void ResetStandings()
        {
            for (var i = 0; i < standings.Count; i++)
            {
                var entry = standings[i];
                entry.Score = 0;
                standings[i] = entry;
            }
        }

        private ulong GetLeadingClient()
        {
            if (standings == null || standings.Count == 0)
            {
                return ulong.MaxValue;
            }

            var bestScore = int.MinValue;
            var bestClient = ulong.MaxValue;
            var tied = false;
            for (var i = 0; i < standings.Count; i++)
            {
                var entry = standings[i];
                if (entry.Score > bestScore)
                {
                    bestScore = entry.Score;
                    bestClient = entry.ClientId;
                    tied = false;
                }
                else if (entry.Score == bestScore)
                {
                    tied = true;
                }
            }

            return tied ? ulong.MaxValue : bestClient;
        }

        private static int GenerateSessionSeed(int roundNumber)
        {
            unchecked
            {
                var time = DateTime.UtcNow.Ticks;
                var hash = (int)(time ^ time >> 32);
                hash = hash * 397 ^ Environment.TickCount;
                hash = hash * 397 ^ roundNumber;
                return hash == 0 ? 1 : hash;
            }
        }

        private void TryGrantLocalReward()
        {
            if (localRewardGranted || phase.Value != RoundPhase.Results ||
                NetworkManager.Singleton == null ||
                winnerClientId.Value != NetworkManager.Singleton.LocalClientId)
            {
                return;
            }

            localRewardGranted = true;
            var updated = PlayerPrefs.GetInt(CosmeticCurrencyKey, 0) +
                          Mathf.Max(0, winnerCosmeticCredits);
            PlayerPrefs.SetInt(CosmeticCurrencyKey, updated);
            PlayerPrefs.Save();
        }

        private void OnGUI()
        {
            if (WorldForgeGameHUD.IsActive || !IsSpawned)
            {
                return;
            }

            switch (phase.Value)
            {
                case RoundPhase.Pregame:
                    DrawPregame();
                    break;
                case RoundPhase.Playing:
                    DrawRoundStatus();
                    break;
                case RoundPhase.Results:
                    DrawResults();
                    break;
            }
        }

        private void DrawPregame()
        {
            var instruction = IsServer
                ? "Gather your rivals at the summit signal  •  Press E there to begin"
                : "The host will begin when everyone is ready at the summit signal";
            var text =
                $"<size=22><b>{publicMatchName.ToUpperInvariant()}</b></size>\n" +
                $"<size=13>{instruction}  •  {NetworkManager.ConnectedClientsIds.Count} " +
                $"PLAYER{(NetworkManager.ConnectedClientsIds.Count == 1 ? string.Empty : "S")}</size>";
            DrawOutlinedLabel(
                new Rect(Screen.width * 0.5f - 360f, 24f, 720f, 68f),
                text,
                18,
                TextAnchor.UpperCenter);
        }

        private void DrawRoundStatus()
        {
            var remaining = Math.Max(
                0d,
                serverRoundEndsAt.Value - NetworkManager.ServerTime.Time);
            var scoreText = string.Join(
                "  ",
                GetOrderedStandings()
                    .Select(entry => $"P{entry.ClientId}: {entry.Score}"));
            DrawOutlinedLabel(
                new Rect(Screen.width * 0.5f - 360f, 18f, 720f, 70f),
                $"<size=22><b>{TimeSpan.FromSeconds(remaining):mm\\:ss}</b></size>\n" +
                $"<size=14>{scoreText}   •   FIRST TO {targetScore}</size>",
                18,
                TextAnchor.UpperCenter);
        }

        private void DrawResults()
        {
            var localId = NetworkManager.Singleton.LocalClientId;
            var winnerText = winnerClientId.Value == ulong.MaxValue
                ? "No winner this round"
                : winnerClientId.Value == localId
                    ? "You won"
                    : $"Player {winnerClientId.Value} won";

            var ranking = string.Join(
                "   ",
                GetOrderedStandings()
                    .Select(entry => $"P{entry.ClientId} {entry.Score}"));
            var continuation = IsServer
                ? "Return to the summit signal and press E to prepare the rematch"
                : "The host can prepare the next round at the summit signal";
            var summary = resultSummary.Value.IsEmpty
                ? string.Empty
                : $"\n<size=14>{resultSummary.Value}</size>";
            DrawOutlinedLabel(
                new Rect(Screen.width * 0.5f - 390f, Screen.height * 0.28f, 780f, 230f),
                $"<size=18>ROUND COMPLETE</size>\n" +
                $"<size=34><b>{winnerText.ToUpperInvariant()}</b></size>{summary}\n\n" +
                $"<size=16>{ranking}</size>\n" +
                $"<size=13>{continuation}  •  " +
                $"{PlayerPrefs.GetInt(CosmeticCurrencyKey, 0)} COSMETIC CREDITS</size>",
                20,
                TextAnchor.UpperCenter);
        }

        private static void DrawOutlinedLabel(
            Rect rect,
            string text,
            int fontSize,
            TextAnchor alignment)
        {
            var shadowStyle = PresentationLabel(fontSize, alignment, new Color(0f, 0f, 0f, 0.82f));
            var faceStyle = PresentationLabel(fontSize, alignment, new Color(0.95f, 0.96f, 0.9f));
            GUI.Label(new Rect(rect.x + 2f, rect.y + 3f, rect.width, rect.height), text, shadowStyle);
            GUI.Label(rect, text, faceStyle);
        }

        private static GUIStyle PresentationLabel(
            int fontSize,
            TextAnchor alignment,
            Color color)
        {
            return new GUIStyle(GUI.skin.label)
            {
                richText = true,
                fontSize = fontSize,
                fontStyle = FontStyle.Normal,
                alignment = alignment,
                wordWrap = true,
                normal = { textColor = color }
            };
        }

        private static Rect CenteredPanel(float width, float height)
        {
            return new Rect(
                (Screen.width - width) * 0.5f,
                (Screen.height - height) * 0.5f,
                width,
                height);
        }

        private static Rect Inset(Rect rect, float padding)
        {
            return new Rect(
                rect.x + padding,
                rect.y + padding,
                rect.width - padding * 2f,
                rect.height - padding * 2f);
        }

        private static GUIStyle RichLabel()
        {
            return new GUIStyle(GUI.skin.label)
            {
                richText = true,
                alignment = TextAnchor.MiddleCenter,
                wordWrap = true
            };
        }

        public PlayerStanding[] GetOrderedStandings()
        {
            var ordered = new PlayerStanding[standings?.Count ?? 0];
            for (var i = 0; i < ordered.Length; i++)
            {
                ordered[i] = standings[i];
            }

            Array.Sort(
                ordered,
                (left, right) =>
                {
                    var scoreComparison = right.Score.CompareTo(left.Score);
                    return scoreComparison != 0
                        ? scoreComparison
                        : left.ClientId.CompareTo(right.ClientId);
                });
            return ordered;
        }
    }
}
