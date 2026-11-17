import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const anchorAbi = [
  { type:'function', name:'anchor', stateMutability:'nonpayable', inputs:[{name:'batchId',type:'bytes32'},{name:'root',type:'bytes32'}], outputs:[] },
  { type:'function', name:'rootOf', stateMutability:'view', inputs:[{name:'batchId',type:'bytes32'}], outputs:[{type:'bytes32'}] }
];
export const batchKey = id => keccak256(toBytes(id));
export const chainConfigured = () => Boolean(process.env.RPC_URL && process.env.ANCHOR_CONTRACT && process.env.CHAIN_ID);
export async function readRoot(batchId) {
  if (!chainConfigured()) return null;
  const client = createPublicClient({ transport:http(process.env.RPC_URL) });
  const chainId = await client.getChainId();
  if (chainId !== Number(process.env.CHAIN_ID)) throw Error('Configured chain ID does not match RPC');
  return client.readContract({ address:process.env.ANCHOR_CONTRACT, abi:anchorAbi, functionName:'rootOf', args:[batchKey(batchId)] });
}
export async function submitAnchor(batchId, root) {
  if (!chainConfigured() || process.env.ENABLE_CHAIN_WRITES !== 'true' || !process.env.ANCHOR_PRIVATE_KEY) return { status:'local' };
  const client = createPublicClient({ transport:http(process.env.RPC_URL) });
  const chainId = await client.getChainId();
  if (chainId !== Number(process.env.CHAIN_ID)) throw Error('Configured chain ID does not match RPC');
  const wallet = createWalletClient({ account:privateKeyToAccount(process.env.ANCHOR_PRIVATE_KEY), transport:http(process.env.RPC_URL) });
  const txHash = await wallet.writeContract({ address:process.env.ANCHOR_CONTRACT, abi:anchorAbi, functionName:'anchor', args:[batchKey(batchId),`0x${root}`], chain:null });
  const receipt = await client.waitForTransactionReceipt({ hash:txHash, timeout:90000 });
  if (receipt.status !== 'success') throw Error(`Transaction reverted: ${txHash}`);
  const onchain = await readRoot(batchId);
  if (onchain?.toLowerCase() !== `0x${root}`) throw Error(`On-chain root mismatch: ${txHash}`);
  return { status:'confirmed', chainId, txHash, blockNumber:String(receipt.blockNumber) };
}
