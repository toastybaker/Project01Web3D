using System.Globalization;

namespace WorldForge.Core.Runtime.Gameplay
{
    public static class WorldForgeProject01Rules
    {
        public const int GuaranteedEscapeCost = 50000;
        public const int ChanceEscapeCost = 15000;

        public static string Money(int amount)
        {
            return $"${amount.ToString("N0", CultureInfo.InvariantCulture)}";
        }

        public static string DisplayItemName(string itemId)
        {
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return string.Empty;
            }

            return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(
                itemId.Replace('_', ' ').Replace('-', ' '));
        }
    }
}
