/**
 * Граф обработки → очередь шагов.
 *
 * Порт src/PROCESSING/utils/createProcessQueue.ts из fs.manager.tauri. Алгоритм
 * сохранён один в один, потому что его результат исполняет то самое десктопное
 * приложение: разойдись порядок шагов — и обработка пойдёт не так, как автор
 * рисовал граф.
 *
 * Отличие одно: на десктопе перед сборкой вызывается syncCostsFromManifest,
 * которая перезаписывает cost/costUnit актуальными значениями из plugin.json.
 * Реестра плагинов на сайте нет и быть не должно — сайт оркестратор, плагины
 * живут на машинах. Поэтому cost берётся таким, каким его сохранил редактор
 * нод, а окончательную цену считает машина, у которой манифесты есть.
 */

export type FlowNode = {
  id: string
  type?: string
  parentId?: string
  position?: { x: number; y: number }
  data?: {
    label?: string
    disabled?: boolean
    output?: unknown
    executionType?: string
    properties?: FlowProperty[]
    colorType?: string
    pluginId?: string
    pluginVersion?: string
    cost?: unknown
    costUnit?: unknown
    comment?: string
    [key: string]: unknown
  }
}

export type FlowProperty = {
  id: string
  isInput?: boolean
  controlType?: string
  controlProps?: {
    value?: unknown
    label?: string
    editLabel?: boolean
    [key: string]: unknown
  }
}

export type FlowEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: { active?: boolean }
}

export type Graph = {
  nodes?: FlowNode[]
  edges?: FlowEdge[]
}

export type QueueStep = Record<string, unknown> & {
  id: string
  nodeType: string
  isTerminal: boolean
}

/**
 * Плоские свойства ноды — порт getNeededPropsFromNode.
 *
 * Ключ свойства: для jsonNavigator всегда id, для остальных — label, если
 * редактор разрешил его переименовать (editLabel), иначе id. Именно по этим
 * ключам плагин потом читает свои параметры.
 */
export function nodeProps(node: FlowNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const data = node.data ?? {}

  const output = data.output as { functionName?: string } | undefined
  if (output?.functionName) out.functionName = output.functionName
  if (data.label) out.nodeLabel = data.label
  if (data.pluginId) out.pluginId = data.pluginId
  if (data.pluginVersion) out.pluginVersion = data.pluginVersion
  if (data.colorType) out.colorType = data.colorType
  if (data.cost !== undefined) out.cost = data.cost
  if (data.costUnit !== undefined) out.costUnit = data.costUnit

  for (const prop of data.properties ?? []) {
    const key =
      prop.controlType === "jsonNavigator"
        ? prop.id
        : prop.controlProps?.editLabel === true
          ? prop.controlProps?.label
          : prop.id
    if (typeof key === "string" && key) {
      out[key] = prop.controlProps?.value
    }
  }

  return out
}

/**
 * Идёт назад по цепочке spy-нод до первой настоящей.
 *
 * Spy — это реройт: он не исполняется, но передаёт связь, поэтому downstream
 * должен ссылаться на реальный источник. null — цепочка обрывается (у spy нет
 * входа) или замкнута.
 */
function resolveSpySource(
  sourceId: string,
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  visited: Set<string> = new Set(),
): string | null {
  if (visited.has(sourceId)) return null
  visited.add(sourceId)
  const node = allNodes.find((n) => n.id === sourceId)
  if (!node || node.type !== "spy") return sourceId
  const incoming = allEdges.find(
    (e) => e.target === sourceId && e.targetHandle === "in",
  )
  if (!incoming) return null
  return resolveSpySource(incoming.source, allNodes, allEdges, visited)
}

function buildExecutionObject(
  id: string,
  nodesMap: Map<string, FlowNode>,
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  onWarn?: (message: string) => void,
): QueueStep | null {
  const node = nodesMap.get(id)
  // Spy не исполняется — он «сплющивается» через resolveSpySource у downstream.
  if (node?.type === "spy") return null
  // Выключенная нода не исполняется, downstream остаётся без источника
  // сознательно: чем его заменить, решает автор графа.
  if (node?.data?.disabled === true) return null
  if (!node?.data?.output) return null

  const executionType = node.data.executionType

  const importObj: Record<string, string> = {}
  const props = node.data.properties ?? []

  for (const p of props.filter((p) => p.isInput)) {
    const edge = allEdges.find((e) => e.target === id && e.targetHandle === p.id)
    if (!edge) continue

    const key =
      p.controlType === "jsonNavigator"
        ? p.id
        : p.controlProps?.editLabel === true
          ? p.controlProps?.label
          : p.id

    const resolvedSource = resolveSpySource(edge.source, allNodes, allEdges)
    if (!resolvedSource) continue
    if (typeof key === "string" && key) importObj[key] = resolvedSource
  }

  if (executionType === "loop") {
    const childNodes = allNodes.filter((n) => n.parentId === id)
    const childIds = new Set(childNodes.map((n) => n.id))
    const innerEdges = allEdges.filter(
      (e) => childIds.has(e.source) && childIds.has(e.target),
    )

    const inputInLoopEdge = allEdges.find(
      (e) => e.source === id && e.sourceHandle === "inputInLoop",
    )
    let resolvedStartId = inputInLoopEdge?.target

    if (!resolvedStartId) {
      const innerIncoming = new Set(innerEdges.map((e) => e.target))
      resolvedStartId = childNodes.find((n) => !innerIncoming.has(n.id))?.id
    }

    const subgraph = resolvedStartId
      ? createProcessQueueFromNodes(
          { nodes: childNodes, edges: innerEdges },
          resolvedStartId,
          allNodes,
          allEdges,
          onWarn,
        )
      : []

    const loopInputEdge = allEdges.find(
      (e) => e.target === id && e.targetHandle === "loopInput",
    )
    const loopInputSource = loopInputEdge
      ? resolveSpySource(loopInputEdge.source, allNodes, allEdges)
      : null

    const loopOutputEdge = allEdges.find(
      (e) => e.target === id && e.targetHandle === "outputInLoop",
    )
    const loopOutputSource = loopOutputEdge
      ? resolveSpySource(loopOutputEdge.source, allNodes, allEdges)
      : null

    return {
      id,
      nodeType: "loop",
      import: { loopInput: loopInputSource },
      loopOutputSource,
      subgraph,
      output: [],
      isTerminal: false,
    }
  }

  const isTerminal = !allEdges.some((e) => e.source === id)

  return {
    id,
    nodeType: "default",
    ...nodeProps(node),
    import: importObj,
    isTerminal,
  }
}

/** Очередь для subgraph loop-ноды; allNodes/allEdges — весь граф. */
function createProcessQueueFromNodes(
  graph: Graph,
  startNodeId: string,
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  onWarn?: (message: string) => void,
): QueueStep[] {
  const nodes = graph.nodes ?? []
  const edges = graph.edges ?? []
  const nodesMap = new Map(nodes.map((n) => [n.id, n]))

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const n of nodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    if (nodesMap.has(e.source) && nodesMap.has(e.target)) {
      incoming.get(e.target)?.push(e.source)
      outgoing.get(e.source)?.push(e.target)
    }
  }

  const startId = [...nodesMap.keys()].find(
    (id) => id.toLowerCase() === startNodeId.toLowerCase(),
  )
  if (!startId) return []

  const executionTargets = new Set<string>()
  function collectOutgoing(id: string) {
    if (executionTargets.has(id)) return
    executionTargets.add(id)
    for (const next of outgoing.get(id) ?? []) collectOutgoing(next)
  }
  collectOutgoing(startId)

  const involved = new Set<string>(executionTargets)
  function collectIncoming(id: string) {
    for (const parent of incoming.get(id) ?? []) {
      if (!involved.has(parent)) {
        involved.add(parent)
        collectIncoming(parent)
      }
    }
  }
  for (const id of executionTargets) collectIncoming(id)

  let prevSize = 0
  while (involved.size !== prevSize) {
    prevSize = involved.size
    for (const id of [...involved]) {
      for (const child of outgoing.get(id) ?? []) {
        if (!involved.has(child)) {
          involved.add(child)
          collectIncoming(child)
        }
      }
    }
  }

  const inDegree = new Map<string, number>()
  for (const id of involved) inDegree.set(id, 0)
  for (const e of edges) {
    if (involved.has(e.source) && involved.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  // Сортировка по X-позиции: левее = раньше. Отражает визуальный порядок графа.
  const queue: string[] = []
  function pushSorted(id: string) {
    queue.push(id)
    queue.sort(
      (a, b) =>
        (nodesMap.get(a)?.position?.x ?? 0) - (nodesMap.get(b)?.position?.x ?? 0),
    )
  }
  for (const [id, deg] of inDegree) {
    if (deg === 0) pushSorted(id)
  }

  const orderedIds: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    orderedIds.push(id)
    for (const child of outgoing.get(id) ?? []) {
      if (!involved.has(child)) continue
      inDegree.set(child, (inDegree.get(child) ?? 0) - 1)
      if (inDegree.get(child) === 0) pushSorted(child)
    }
  }

  if (onWarn && orderedIds.length !== involved.size) {
    const dropped = [...involved].filter((id) => !orderedIds.includes(id))
    onWarn(
      `В графе цикл внутри loop-ноды: не будут выполнены — ${dropped.join(", ")}.`,
    )
  }

  return orderedIds
    .map((id) => buildExecutionObject(id, nodesMap, allNodes, allEdges, onWarn))
    .filter((step): step is QueueStep => step !== null)
}

/**
 * Собирает очередь исполнения из графа.
 *
 * `onWarn` — канал для того, о чём иначе никто не узнает. Kahn ниже упорядочивает
 * узлы по входящим рёбрам, и узел, входящий в ЦИКЛ, до нулевой степени не доходит
 * никогда: он просто не попадает в очередь. Редактор нод замкнуть цикл больше не
 * даёт, но в уже сохранённых графах он может лежать, и тогда часть обработки
 * молча не выполнится.
 */
export function createProcessQueue(
  graph: Graph,
  startNodeId = "mainSearch",
  onWarn?: (message: string) => void,
): QueueStep[] {
  const nodes = graph.nodes ?? []
  // Рёбра от выключенных нод не существуют для очереди исполнения.
  // Отсутствие data.active означает active (так сохраняли раньше).
  const edges = (graph.edges ?? []).filter((e) => e?.data?.active !== false)
  const allNodesMap = new Map(nodes.map((n) => [n.id, n]))

  const topLevelNodes = nodes.filter((n) => !n.parentId)
  const topLevelIds = new Set(topLevelNodes.map((n) => n.id))

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const n of topLevelNodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    if (topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
      incoming.get(e.target)?.push(e.source)
      outgoing.get(e.source)?.push(e.target)
    }
  }

  const startId = [...topLevelIds].find(
    (id) => id.toLowerCase() === startNodeId.toLowerCase(),
  )
  if (!startId) return []

  const executionTargets = new Set<string>()
  function collectOutgoing(id: string) {
    if (executionTargets.has(id)) return
    executionTargets.add(id)
    for (const next of outgoing.get(id) ?? []) collectOutgoing(next)
  }
  collectOutgoing(startId)

  const involved = new Set<string>(executionTargets)
  function collectIncomingTopLevel(id: string) {
    for (const parent of incoming.get(id) ?? []) {
      if (!involved.has(parent)) {
        involved.add(parent)
        collectIncomingTopLevel(parent)
      }
    }
  }
  for (const id of executionTargets) collectIncomingTopLevel(id)

  // Cross-boundary: у loop-нод подтягиваем внешние ноды, подключённые к их детям.
  for (const id of executionTargets) {
    const node = allNodesMap.get(id)
    if (node?.data?.executionType !== "loop") continue

    const childIds = new Set(
      nodes.filter((n) => n.parentId === id).map((n) => n.id),
    )
    for (const e of edges) {
      if (topLevelIds.has(e.source) && childIds.has(e.target)) {
        if (!involved.has(e.source)) {
          involved.add(e.source)
          collectIncomingTopLevel(e.source)
        }
      }
    }
  }

  // Forward-расширение от backward-найденных нод до стабилизации: если нода
  // попала в involved как зависимость, её outgoing-соседей тоже надо выполнить.
  let prevSize = 0
  while (involved.size !== prevSize) {
    prevSize = involved.size
    for (const id of [...involved]) {
      for (const child of outgoing.get(id) ?? []) {
        if (!involved.has(child)) {
          involved.add(child)
          collectIncomingTopLevel(child)
        }
      }
    }
  }

  const inDegree = new Map<string, number>()
  for (const id of involved) inDegree.set(id, 0)
  for (const e of edges) {
    if (
      involved.has(e.source) &&
      involved.has(e.target) &&
      topLevelIds.has(e.source) &&
      topLevelIds.has(e.target)
    ) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  function pushSorted(id: string) {
    queue.push(id)
    queue.sort(
      (a, b) =>
        (allNodesMap.get(a)?.position?.x ?? 0) -
        (allNodesMap.get(b)?.position?.x ?? 0),
    )
  }
  for (const [id, deg] of inDegree) {
    if (deg === 0) pushSorted(id)
  }

  const orderedIds: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    orderedIds.push(id)
    for (const child of outgoing.get(id) ?? []) {
      if (!involved.has(child)) continue
      inDegree.set(child, (inDegree.get(child) ?? 0) - 1)
      if (inDegree.get(child) === 0) pushSorted(child)
    }
  }

  if (onWarn && orderedIds.length !== involved.size) {
    const dropped = [...involved].filter((id) => !orderedIds.includes(id))
    const names = dropped
      .map((id) => {
        const label = allNodesMap.get(id)?.data?.label
        return label ? `${label} (${id})` : id
      })
      .join(", ")
    onWarn(
      `В графе цикл: ноды не будут выполнены — ${names}. ` +
        `Уберите обратную связь между ними (стрелку, ведущую назад).`,
    )
  }

  const involvedNodesMap = new Map<string, FlowNode>()
  for (const id of involved) {
    const node = allNodesMap.get(id)
    if (node) involvedNodesMap.set(id, node)
  }

  return orderedIds
    .map((id) =>
      buildExecutionObject(id, involvedNodesMap, nodes, edges, onWarn),
    )
    .filter((step): step is QueueStep => step !== null)
}
