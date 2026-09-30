import type { Metadata } from 'next'
import { SpikeRuntime } from '../../../src/spike/SpikeRuntime'

export const metadata: Metadata = {
  title: 'spike · data-model runtime probe',
  robots: { index: false, follow: false },
}

export default function SpikeRuntimePage() {
  return <SpikeRuntime />
}
