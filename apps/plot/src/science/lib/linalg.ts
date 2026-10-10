/** 小型线性代数：高斯消元求解与矩阵求逆。仅服务拟合与平滑的正规方程。 */

export function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = matrix.length
  const augmented = matrix.map((row, i) => [...row, rhs[i]])
  const solution = new Array<number>(n).fill(0)

  for (let column = 0; column < n; column += 1) {
    let pivot = column
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row
      }
    }

    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      continue
    }

    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]

    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue
      }
      const factor = augmented[row][column] / augmented[column][column]
      if (factor === 0) {
        continue
      }
      for (let j = column; j <= n; j += 1) {
        augmented[row][j] -= factor * augmented[column][j]
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    const diagonal = augmented[i][i]
    solution[i] = Math.abs(diagonal) < 1e-12 ? 0 : augmented[i][n] / diagonal
  }

  return solution
}

export function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length
  const augmented = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])

  for (let column = 0; column < n; column += 1) {
    let pivot = column
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row
      }
    }

    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      throw new Error('linalg: singular matrix')
    }

    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let j = 0; j < 2 * n; j += 1) {
      augmented[column][j] /= divisor
    }

    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue
      }
      const factor = augmented[row][column]
      if (factor === 0) {
        continue
      }
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row][j] -= factor * augmented[column][j]
      }
    }
  }

  return augmented.map((row) => row.slice(n))
}
