namespace WorldForge.Core.Runtime.Gameplay
{
    public interface IWorldForgeInteractable
    {
        string GetPrompt(Networking.WorldForgePlayer player);
        void Interact(Networking.WorldForgePlayer player);
    }
}
