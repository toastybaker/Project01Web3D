using UnityEngine;

namespace WorldForge.Core.Runtime.Gameplay
{
    public static class WorldForgeFarmCatalog
    {
        public enum Crop : byte
        {
            None,
            Lettuce,
            Mushroom,
            Pumpkin,
            Tomato,
            Watermelon
        }

        public readonly struct Definition
        {
            public Definition(
                Crop crop,
                string displayName,
                int seedCost,
                int seedsPerPack,
                int initialStock,
                int stockRefill,
                float growthSeconds,
                int harvestYield,
                int baseSalePrice,
                int volatilityPercent,
                int bonusHarvests)
            {
                Crop = crop;
                DisplayName = displayName;
                SeedCost = seedCost;
                SeedsPerPack = seedsPerPack;
                InitialStock = initialStock;
                StockRefill = stockRefill;
                GrowthSeconds = growthSeconds;
                HarvestYield = harvestYield;
                BaseSalePrice = baseSalePrice;
                VolatilityPercent = volatilityPercent;
                BonusHarvests = bonusHarvests;
            }

            public Crop Crop { get; }
            public string DisplayName { get; }
            public int SeedCost { get; }
            public int SeedsPerPack { get; }
            public int InitialStock { get; }
            public int StockRefill { get; }
            public float GrowthSeconds { get; }
            public int HarvestYield { get; }
            public int BaseSalePrice { get; }
            public int VolatilityPercent { get; }
            public int BonusHarvests { get; }
        }

        public const int CropCount = 5;

        public static Definition Get(Crop crop)
        {
            return crop switch
            {
                Crop.Lettuce => new Definition(
                    crop, "LETTUCE", 3, 3, 10, 4, 22f, 2, 3, 15, 0),
                Crop.Mushroom => new Definition(
                    crop, "MUSHROOM", 6, 2, 7, 3, 31f, 2, 6, 35, 1),
                Crop.Pumpkin => new Definition(
                    crop, "PUMPKIN", 11, 2, 5, 2, 62f, 3, 9, 25, 0),
                Crop.Tomato => new Definition(
                    crop, "TOMATO", 8, 3, 7, 3, 43f, 2, 6, 20, 2),
                Crop.Watermelon => new Definition(
                    crop, "WATERMELON", 14, 2, 4, 2, 74f, 3, 12, 45, 0),
                _ => new Definition(
                    Crop.None, "NONE", 0, 0, 0, 0, 1f, 0, 0, 0, 0)
            };
        }

        public static Crop FromIndex(int index)
        {
            return (Crop)Mathf.Clamp(index + 1, 1, CropCount);
        }

        public static int ToIndex(Crop crop)
        {
            return crop is >= Crop.Lettuce and <= Crop.Watermelon
                ? (int)crop - 1
                : -1;
        }
    }
}

