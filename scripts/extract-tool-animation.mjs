import { Document, NodeIO } from '@gltf-transform/core'

const source = 'source-assets/3d/characters/animations/UAL2_Standard.glb'
const output = 'public/assets/3d/animations/tool-actions.glb'
const clipName = 'TreeChopping_Loop'

const io = new NodeIO()
const sourceDocument = await io.read(source)
const selected = sourceDocument.getRoot().listAnimations().find((animation) => animation.getName() === clipName)

if (!selected) throw new Error(`${clipName} is missing from ${source}`)

const retainedBones = new Set([
  'pelvis',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l',
  'thigh_r', 'calf_r', 'foot_r', 'ball_r',
  'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
])
const retainedChannels = selected.listChannels().filter((channel) => {
  const nodeName = channel.getTargetNode()?.getName()
  const path = channel.getTargetPath()
  // Runtime movement owns the character root. Only import the authored pose;
  // root translation from the source rig otherwise pulls the ranger out of the
  // third-person frame when the action begins.
  const carriesPose = path === 'rotation'
  return Boolean(nodeName && retainedBones.has(nodeName) && carriesPose)
})

const document = new Document()
const buffer = document.createBuffer('Tool animation buffer')
const scene = document.createScene('Tool animation targets')
const animation = document.createAnimation(clipName)
const nodes = new Map()

const animationNode = (name) => {
  if (!nodes.has(name)) {
    const node = document.createNode(name)
    nodes.set(name, node)
    scene.addChild(node)
  }
  return nodes.get(name)
}

const cloneAccessor = (sourceAccessor, name) => document.createAccessor(name)
  .setType(sourceAccessor.getType())
  .setNormalized(sourceAccessor.getNormalized())
  .setArray(sourceAccessor.getArray().slice())
  .setBuffer(buffer)

retainedChannels.forEach((sourceChannel, index) => {
  const sourceSampler = sourceChannel.getSampler()
  const sourceNode = sourceChannel.getTargetNode()
  const input = cloneAccessor(sourceSampler.getInput(), `${clipName} ${index} input`)
  const outputAccessor = cloneAccessor(sourceSampler.getOutput(), `${clipName} ${index} output`)
  const sampler = document.createAnimationSampler(`${clipName} ${index}`)
    .setInput(input)
    .setOutput(outputAccessor)
    .setInterpolation(sourceSampler.getInterpolation())
  const channel = document.createAnimationChannel(`${clipName} ${index}`)
    .setSampler(sampler)
    .setTargetNode(animationNode(sourceNode.getName()))
    .setTargetPath(sourceChannel.getTargetPath())
  animation.addSampler(sampler).addChannel(channel)
})

await io.write(output, document)
console.log(`${output} (${clipName}, ${retainedChannels.length} channels)`)
