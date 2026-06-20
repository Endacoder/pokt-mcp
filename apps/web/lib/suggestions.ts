export type Suggestion = {
  /** Full prompt sent when the chip is clicked */
  text: string;
  /** Short label shown in the compact bar above the input */
  label: string;
  icon: string;
  requiresWallet?: boolean;
};

export const READ_SUGGESTIONS: Suggestion[] = [
  { label: "Base block", text: "Latest block on Base", icon: "⛓" },
  { label: "List chains", text: "List all Pocket chains", icon: "🌐" },
  { label: "ETH gas", text: "Gas price on Ethereum", icon: "⛽" },
  {
    label: "Vitalik balance",
    text: "Balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
    icon: "💰",
  },
  { label: "ETH price", text: "Price of ETH in USD", icon: "📈" },
];

export const WALLET_READ_SUGGESTIONS: Suggestion[] = [
  { label: "My balance", text: "What is my wallet balance?", icon: "👛" },
];

export const WRITE_SUGGESTIONS: Suggestion[] = [
  {
    label: "Send ETH",
    text: "Send 0.001 ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    icon: "📤",
    requiresWallet: true,
  },
];
