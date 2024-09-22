#!/usr/bin/env ts-node

import { TokenPair, TradeActionBNStr, StrategyUpdate } from '@bancor/carbon-sdk';
import { ContractsApi, ContractsConfig } from '@bancor/carbon-sdk/contracts-api';
import { initSyncedCache, ChainCache } from '@bancor/carbon-sdk/chain-cache';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { base_config } from './config';
import { Command } from 'commander';
import { BigNumber, Wallet } from 'ethers';
import { Toolkit, MarginalPriceOptions } from '@bancor/carbon-sdk/strategy-management';
import { EncodedStrategy, EncodedStrategyBNStr } from '@bancor/carbon-sdk';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Interface } from '@ethersproject/abi';

dotenv.config();

type RetypeProps<T, U, V> = {
  [K in keyof T]: T[K] extends U ? V : T[K];
};

let api: ContractsApi;
let sdkCache: ChainCache;
let sdk: Toolkit;
const MAX_BLOCK_AGE = 2000;

async function initSDK() {
  const rpcUrl = 'https://mainnet.base.org';
  const config: ContractsConfig = {
    carbonControllerAddress: base_config.carbon.carbonController,
    multiCallAddress: base_config.utils.multicall,
    voucherAddress: base_config.carbon.voucher,
  };

  const provider = new StaticJsonRpcProvider({ url: rpcUrl, skipFetchSetup: true }, 1);
  api = new ContractsApi(provider, config);
  const { cache, startDataSync } = initSyncedCache(api.reader, undefined);
  sdkCache = cache;
  sdk = new Toolkit(api, cache);

  cache.on('onPairDataChanged', (affectedPairs) => {
    console.log('Pair data changed:', affectedPairs);
  });

  cache.on('onPairAddedToCache', (affectedPairs) => {
    console.log('Pair added to cache:', affectedPairs);
  });

  sdkCache.setCacheMissHandler(async (token0: string, token1: string) => {
    console.log(`Cache miss for pair: ${token0}-${token1}`);
    const strategies = await api.reader.strategiesByPair(token0, token1);
    if (strategies) {
      sdkCache.addPair(token0, token1, strategies);
    }
  });

  await startDataSync();
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Carbon SDK initialized successfully');
}

const program = new Command();

program
  .version('1.0.0')
  .description('Carbon SDK CLI');

program
  .command('init')
  .description('Initialize the Carbon SDK')
  .action(async () => {
    try {
      await initSDK();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('get-pair-info <token0> <token1>')
  .description('Get information about a token pair')
  .action(async (token0: string, token1: string) => {
    try {
      await initSDK();
      const pairs: TokenPair[] = await api.reader.pairs();
      const tokenPair = pairs.find(pair => 
        (pair[0] === token0 && pair[1] === token1) || 
        (pair[0] === token1 && pair[1] === token0)
      );
      if (tokenPair) {
        console.log('Token Pair Info:', tokenPair);
      } else {
        console.log('Token Pair not found');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });

program
  .command('get-cached-pairs')
  .description('Get all cached pairs')
  .action(async () => {
    try {
      await initSDK();
      const cachedPairs = sdkCache.getCachedPairs();
      console.log('Cached Pairs:', cachedPairs);
    } catch (error) {
      console.error('Error:', error);
    }
  });

program
  .command('update-strategy <strategyId>')
  .description('Update a strategy')
  .option('--buyPriceLow <price>', 'New buy price low')
  .option('--buyPriceHigh <price>', 'New buy price high')
  .option('--buyBudget <amount>', 'New buy budget')
  .option('--sellPriceLow <price>', 'New sell price low')
  .option('--sellPriceHigh <price>', 'New sell price high')
  .option('--sellBudget <amount>', 'New sell budget')
  .option('--buyPriceMarginal <price>', 'New buy price marginal')
  .option('--sellPriceMarginal <price>', 'New sell price marginal')
  .action(async (strategyId, options) => {
    try {
      await initSDK();

      const existingStrategy = await sdk.getStrategyById(strategyId);
      console.log('Existing strategy:', existingStrategy);
      console.log('Strategy encoded:', existingStrategy.encoded);
      
      const strategyUpdate: StrategyUpdate = {
        buyPriceLow: options.buyPriceLow,
        buyPriceHigh: options.buyPriceHigh,
        buyBudget: options.buyBudget,
        sellPriceLow: options.sellPriceLow,
        sellPriceHigh: options.sellPriceHigh,
        sellBudget: options.sellBudget,
      };

      const buyPriceMarginal = options.buyPriceMarginal ? 
        (options.buyPriceMarginal === 'RESET' ? MarginalPriceOptions.reset :
         options.buyPriceMarginal === 'MAINTAIN' ? MarginalPriceOptions.maintain :
         options.buyPriceMarginal) : 
        undefined;

      const sellPriceMarginal = options.sellPriceMarginal ? 
        (options.sellPriceMarginal === 'RESET' ? MarginalPriceOptions.reset :
         options.sellPriceMarginal === 'MAINTAIN' ? MarginalPriceOptions.maintain :
         options.sellPriceMarginal) : 
        undefined;

      const tx = await sdk.updateStrategy(
        strategyId,
        existingStrategy.encoded,
        strategyUpdate,
        buyPriceMarginal,
        sellPriceMarginal
      );

      console.log('Update strategy transaction:', tx);

      // Load private key from .env
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Private key not found in .env file');
      }

      // Create a new provider
      const rpcUrl = 'https://mainnet.base.org';
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      console.log('Provider created:', provider);

      // Create a wallet with the new provider
      const wallet = new ethers.Wallet(privateKey, provider);
      console.log('Wallet created and connected:', wallet.address);

      // Send the transaction
      const response = await wallet.sendTransaction(tx);
      console.log('Transaction sent:', response.hash);

      // Wait for the transaction to be mined
      const receipt = await response.wait();
      console.log('Transaction receipt:', receipt);
    } catch (error) {
      console.error('Error updating strategy:', error);
    }
  });

async function proposeUpdateStrategy(governorAddress: string, strategyId: string, strategyUpdate: StrategyUpdate, buyPriceMarginal?: string, sellPriceMarginal?: string) {
  try {
    await initSDK();

    const existingStrategy = await sdk.getStrategyById(strategyId);
    console.log('Existing strategy:', existingStrategy);

    // Create the transaction data for updateStrategy
    const carbonControllerInterface = new Interface([
      "function updateStrategy(uint256 strategyId, bytes calldata encodedStrategy, tuple(uint256 buyPriceLow, uint256 buyPriceHigh, uint256 buyBudget, uint256 sellPriceLow, uint256 sellPriceHigh, uint256 sellBudget) update, uint256 buyPriceMarginal, uint256 sellPriceMarginal) external"
    ]);

    const updateData = carbonControllerInterface.encodeFunctionData("updateStrategy", [
      strategyId,
      existingStrategy.encoded,
      strategyUpdate,
      buyPriceMarginal || 0,
      sellPriceMarginal || 0
    ]);

    // Create the proposal description
    const description = `Update strategy ${strategyId}`;

    // Create the Governor interface
    const governorInterface = new Interface([
      "function propose(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) public returns (uint256)"
    ]);

    // Encode the proposal function call
    const proposalData = governorInterface.encodeFunctionData("propose", [
      [base_config.carbon.carbonController], // target address
      [0], // value (0 ETH)
      [updateData], // calldata
      description
    ]);

    console.log('Proposal data:', proposalData);

    // Load private key from .env
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Private key not found in .env file');
    }

    // Create a new provider
    const rpcUrl = 'https://mainnet.base.org';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Create a wallet with the new provider
    const wallet = new ethers.Wallet(privateKey, provider);

    // Create contract instance
    const governorContract = new ethers.Contract(governorAddress, governorInterface, wallet);

    // Send the transaction
    const tx = await governorContract.propose(
      [base_config.carbon.carbonController],
      [0],
      [updateData],
      description,
      { gasLimit: 1000000 } // Adjust gas limit as needed
    );

    console.log('Proposal transaction sent:', tx.hash);

    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    console.log('Proposal transaction receipt:', receipt);

    // Get the ProposalCreated event
    const proposalCreatedEvent = receipt.events?.find((e: { event: string; }) => e.event === 'ProposalCreated');
    if (proposalCreatedEvent) {
      console.log('Proposal ID:', proposalCreatedEvent.args.proposalId.toString());
    }

  } catch (error) {
    console.error('Error proposing update strategy:', error);
  }
}

program
  .command('propose-update-strategy <governorAddress> <strategyId>')
  .description('Propose an update to a strategy via the Governor contract')
  .option('--buyPriceLow <price>', 'New buy price low')
  .option('--buyPriceHigh <price>', 'New buy price high')
  .option('--buyBudget <amount>', 'New buy budget')
  .option('--sellPriceLow <price>', 'New sell price low')
  .option('--sellPriceHigh <price>', 'New sell price high')
  .option('--sellBudget <amount>', 'New sell budget')
  .option('--buyPriceMarginal <price>', 'New buy price marginal')
  .option('--sellPriceMarginal <price>', 'New sell price marginal')
  .action(async (governorAddress, strategyId, options) => {
    const strategyUpdate: StrategyUpdate = {
      buyPriceLow: options.buyPriceLow,
      buyPriceHigh: options.buyPriceHigh,
      buyBudget: options.buyBudget,
      sellPriceLow: options.sellPriceLow,
      sellPriceHigh: options.sellPriceHigh,
      sellBudget: options.sellBudget,
    };

    await proposeUpdateStrategy(governorAddress, strategyId, strategyUpdate, options.buyPriceMarginal, options.sellPriceMarginal);
  });

program.parse(process.argv);
