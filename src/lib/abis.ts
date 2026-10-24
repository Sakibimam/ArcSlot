// ABIs extracted from contracts/out — keep in sync with Slot.sol and SlotFactory.sol

export const SLOT_FACTORY_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createSlot',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'payRef', type: 'bytes32' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'feeRecipient', type: 'address' },
    ],
    outputs: [{ name: 'slot', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'predict',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'payRef', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'slots',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'sweepMany',
    inputs: [{ name: 'slotAddresses', type: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'SlotCreated',
    inputs: [
      { name: 'slot', type: 'address', indexed: true },
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'payRef', type: 'bytes32', indexed: true },
      { name: 'feeBps', type: 'uint16', indexed: false },
      { name: 'feeRecipient', type: 'address', indexed: false },
    ],
  },
] as const;

export const SLOT_ABI = [
  {
    type: 'function',
    name: 'merchant',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'payRef',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeRecipient',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quarantined',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'sweep',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolveQuarantine',
    inputs: [
      { name: 'newMerchant', type: 'address' },
      { name: 'newFeeRecipient', type: 'address' },
      { name: 'newFeeBps', type: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Received',
    inputs: [
      { name: 'payRef_', type: 'bytes32', indexed: true },
      { name: 'gross', type: 'uint256', indexed: false },
      { name: 'net', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
      { name: 'reimbursement', type: 'uint256', indexed: false },
      { name: 'sweeper', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Quarantined',
    inputs: [
      { name: 'slot', type: 'address', indexed: true },
      { name: 'payRef_', type: 'bytes32', indexed: true },
      { name: 'who', type: 'address', indexed: true },
    ],
  },
  {
    type: 'error',
    name: 'NothingToSweep',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AlreadyInitialised',
    inputs: [],
  },
] as const;
