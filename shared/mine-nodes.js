function seeded(index, salt = 0) {
  const value = Math.sin((index + 1) * 91.733 + salt * 37.17) * 43758.5453
  return value - Math.floor(value)
}

const shallowCenters = [[-19,-4],[-38,-11],[-50,-27],[-40,-42],[-20,-31],[19,-4],[38,-13],[51,-28],[41,-42],[20,-32],[-53,-43],[53,-44]]
const middleCenters = [[-29,-53],[-47,-61],[-55,-82],[-42,-96],[-22,-94],[-22,-76],[29,-54],[47,-62],[55,-84],[43,-97],[23,-94]]
const deepCenters = [[-28,-109],[-44,-116],[-43,-134],[-28,-147],[-14,-145],[-53,-147],[28,-109],[44,-116],[44,-134],[29,-147],[15,-145],[-35,-169],[34,-171],[-29,-188],[27,-189],[-22,-211],[21,-215],[-24,-233],[23,-236],[0,-246]]

function buildMineNodeSites() {
  const positions = [[-5,10],[6,7],[-8,1],[8,-2]]
  ;[...shallowCenters, ...middleCenters, ...deepCenters].forEach(([cx, cz], clusterIndex) => {
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 + seeded(clusterIndex, 5300) * 0.8
      const radius = 1.65 + seeded(index + clusterIndex * 7, 5310) * 1.85
      positions.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius])
    }
  })
  const centralSites = [[-6,-12],[7,-23],[-5,-38],[6,-51],[-7,-66],[5,-79],[-6,-93],[7,-108],[-5,-123],[6,-139],[-7,-155],[5,-171],[-4,-188],[6,-207],[-5,-225],[4,-244]]
  centralSites.forEach(([x, z], index) => positions.push([x + (seeded(index, 5381) - 0.5) * 2.6, z]))
  return positions.map(([x, z], index) => ({ id: `MineOre${String(index).padStart(3, '0')}`, x, z }))
}

export const MINE_NODE_SITES = Object.freeze(buildMineNodeSites())
export const MINE_NODE_BY_ID = new Map(MINE_NODE_SITES.map((node) => [node.id, node]))
