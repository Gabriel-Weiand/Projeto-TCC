/** Mock do parque — apenas nomes e specs públicas. Sem credenciais, hosts reais ou AnyDesk. */
export type MockLabMachine = {
  name: string
  hasGpu: boolean
  cpuModel: string
  gpuModel: string | null
  /** RAM wire GB×10 */
  totalRamGb: number
  /** VRAM wire GB×10 */
  totalVramGb: number | null
  /** Sem SSH exposto no seed (AnyDesk ou acesso interno). */
  anyDeskOnly: boolean
  disksGb: number[]
  /** Descrição fixa (padrão: vazio ou AnyDesk). */
  description?: string
  /** Token do agente pré-definido (dev / máquina real no laboratório). */
  token?: string
}

export const ANYDESK_DESCRIPTION = 'Máquinas acessíveis apenas por AnyDesk'

export const MOCK_LAB_MACHINES: MockLabMachine[] = [
  {
    name: 'Euler',
    hasGpu: true,
    cpuModel: 'Intel Core i9-14900F 3.6 GHz',
    gpuModel: 'NVIDIA RTX A6000',
    totalRamGb: 960,
    totalVramGb: 480,
    anyDeskOnly: false,
    disksGb: [4000, 1000],
  },
  {
    name: 'GaciG1',
    hasGpu: false,
    cpuModel: 'Intel Xeon E5-2640 v3 2.60 GHz',
    gpuModel: null,
    totalRamGb: 320,
    totalVramGb: null,
    anyDeskOnly: false,
    disksGb: [2000],
  },
  {
    name: 'GaciG2',
    hasGpu: false,
    cpuModel: 'Intel Xeon E5-2650 v4 2.20 GHz',
    gpuModel: null,
    totalRamGb: 480,
    totalVramGb: null,
    anyDeskOnly: false,
    disksGb: [2000, 20],
  },
  {
    name: 'GaciS1',
    hasGpu: false,
    cpuModel: 'Intel Xeon E5645 2.4 GHz',
    gpuModel: null,
    totalRamGb: 240,
    totalVramGb: null,
    anyDeskOnly: false,
    disksGb: [2000, 300],
  },
  {
    name: 'Sócrates',
    hasGpu: true,
    cpuModel: 'AMD Ryzen 7 5700X 3.4 GHz',
    gpuModel: 'NVIDIA GeForce RTX 3070',
    totalRamGb: 320,
    totalVramGb: 80,
    anyDeskOnly: true,
    disksGb: [480],
  },
  {
    name: 'Darwin',
    hasGpu: true,
    cpuModel: 'Intel Core i7-10700F 2.9 GHz',
    gpuModel: 'NVIDIA GeForce RTX 3080',
    totalRamGb: 480,
    totalVramGb: 100,
    anyDeskOnly: true,
    disksGb: [480],
  },
  {
    name: 'Notebook-server',
    description: 'server',
    token:
      'd9363d229ca5936412f867a92f71690766adbf8bc3b3b0510340980a01ab1f71971028bb520dbd3780730de6b5a79ea235fe647fda8063f7269d6020a80c0723',
    hasGpu: true,
    cpuModel: 'Intel Core i7-7700HQ 2.80 GHz',
    gpuModel: 'NVIDIA GeForce GTX 1050 Ti',
    totalRamGb: 160,
    totalVramGb: 40,
    anyDeskOnly: false,
    disksGb: [480],
  },
]
