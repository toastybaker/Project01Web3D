export type MineNodeSite = Readonly<{ id: string; x: number; z: number }>
export const MINE_NODE_SITES: readonly MineNodeSite[]
export const MINE_NODE_BY_ID: ReadonlyMap<string, MineNodeSite>
