using UnityEngine;
using WorldForge.Core.Networking;

namespace WorldForge.Core.Runtime.Gameplay
{
    public sealed class WorldForgeStockTerminal :
        MonoBehaviour,
        IWorldForgeInteractable
    {
        public string GetPrompt(WorldForgePlayer player)
        {
            var round = WorldForgeRoundDirector.Current;
            return round != null && round.IsRoundActive
                ? WorldForgeLocalization.Text(
                    "OPEN THE SETTLEMENT EXCHANGE",
                    "주식 거래소 열기")
                : string.Empty;
        }

        public void Interact(WorldForgePlayer player)
        {
            if (player == null || !player.IsOwner)
            {
                return;
            }

            if (WorldForgeRoundDirector.Current == null ||
                !WorldForgeRoundDirector.Current.IsRoundActive)
            {
                return;
            }

            WorldForgeStockOverlay.OpenMarket();
        }
    }
}
