// Budget files with their ancestors; exclude empty branches.
export function capTreeNodes(candidates, root, maxNodes) {
  const available = new Map();
  for (const node of candidates) if (!available.has(node.path)) available.set(node.path, node);
  const nodes = new Map();
  let limited = false;
  for (const file of available.values()) {
    if (file.type !== 'file' || nodes.has(file.path)) continue;
    const chain = [file];
    const seen = new Set([file.path]);
    let ancestor = file.parent;
    while (ancestor !== root && !nodes.has(ancestor)) {
      const directory = available.get(ancestor);
      if (!directory || directory.type !== 'directory' || seen.has(ancestor)) break;
      chain.unshift(directory);
      seen.add(ancestor);
      ancestor = directory.parent;
    }
    if (ancestor !== root && !nodes.has(ancestor)) continue;
    if (nodes.size + chain.length > maxNodes) { limited = true; break; }
    for (const node of chain) nodes.set(node.path, node);
  }
  return { nodes, limited };
}
