import { ScientificImageWorkspace } from '../../src/imagej/components/ScientificImageWorkspace'

/**
 * 科学图像工作台（新计算引擎）。
 * 旧版 ImageJ 8 位工作台保留在 `/imagej/classic`。
 */
export default function ImagejPage() {
  return <ScientificImageWorkspace />
}
