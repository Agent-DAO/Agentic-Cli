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
  .option('--buyPriceMarginal <price>', 'New buy price marginal (number, "RESET", or "MAINTAIN")')
  .option('--sellPriceMarginal <price>', 'New sell price marginal (number, "RESET", or "MAINTAIN")')
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

const TIMELOCK_ADDRESS = '0x4b339A63be892204081AdCd02ac980FA71400e01';
const GOVERNOR_ADDRESS = '0x0395FA5e53e2a9C9528539360324Da422708aCbD';
const VOUCHER_ADDRESS = base_config.carbon.voucher;

async function proposeUpdateStrategy(governorAddress: string, strategyId: string, strategyUpdate: StrategyUpdate, buyPriceMarginal?: string, sellPriceMarginal?: string) {
  try {
    await initSDK();

    const existingStrategy = await sdk.getStrategyById(strategyId);
    console.log('Existing strategy:', existingStrategy);

    // Use the SDK's updateStrategy method to get the transaction data
    const tx = await sdk.updateStrategy(
      strategyId,
      existingStrategy.encoded,
      strategyUpdate,
      buyPriceMarginal,
      sellPriceMarginal
    );

    // Create the proposal description
    const description = `Update strategy ${strategyId}`;

    // Create the Governor interface
    const governorInterface = new Interface([
      "function propose(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) public returns (uint256)"
    ]);

    // Encode the proposal function call
    const proposalData = governorInterface.encodeFunctionData("propose", [
      [base_config.carbon.carbonController],
      [0],
      [tx.data],
      description
    ]);

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

    // Send the proposal transaction
    const proposalTx = await wallet.sendTransaction({
      to: governorAddress,
      data: proposalData,
      gasLimit: 1000000 // Adjust gas limit as needed
    });

    console.log('Proposal transaction sent:', proposalTx.hash);

    // Wait for the transaction to be mined
    const receipt = await proposalTx.wait();
    console.log('Proposal transaction receipt:', receipt);

    // Get the ProposalCreated event
    const proposalCreatedEvent = receipt.logs?.find((log) => {
      const parsedLog = governorInterface.parseLog(log);
      return parsedLog.name === 'ProposalCreated';
    });
    if (proposalCreatedEvent) {
      const parsedLog = governorInterface.parseLog(proposalCreatedEvent);
      console.log('Proposal ID:', parsedLog.args.proposalId.toString());
    }

  } catch (error) {
    console.error('Error proposing update strategy:', error);
  }
}

program
  .command('propose-update-strategy <strategyId>')
  .description('Propose an update to a strategy via the Governor contract')
  .option('--buyPriceLow <price>', 'New buy price low')
  .option('--buyPriceHigh <price>', 'New buy price high')
  .option('--buyBudget <amount>', 'New buy budget')
  .option('--sellPriceLow <price>', 'New sell price low')
  .option('--sellPriceHigh <price>', 'New sell price high')
  .option('--sellBudget <amount>', 'New sell budget')
  .option('--buyPriceMarginal <price>', 'New buy price marginal (number, "RESET", or "MAINTAIN")')
  .option('--sellPriceMarginal <price>', 'New sell price marginal (number, "RESET", or "MAINTAIN")')
  .action(async (strategyId, options) => {
    const strategyUpdate: StrategyUpdate = {
      buyPriceLow: options.buyPriceLow,
      buyPriceHigh: options.buyPriceHigh,
      buyBudget: options.buyBudget,
      sellPriceLow: options.sellPriceLow,
      sellPriceHigh: options.sellPriceHigh,
      sellBudget: options.sellBudget,
    };

    await proposeUpdateStrategy(GOVERNOR_ADDRESS, strategyId, strategyUpdate, options.buyPriceMarginal, options.sellPriceMarginal);
  });

async function transferStrategy(strategyId: string) {
  try {
    await initSDK();

    const existingStrategy = await sdk.getStrategyById(strategyId);
    console.log('Existing strategy:', existingStrategy);

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

    // Create the transaction data for transferFrom on the voucher contract
    const voucherInterface = new ethers.utils.Interface([
      "function transferFrom(address from, address to, uint256 tokenId) external"
    ]);

    // Create contract instance
    const voucherContract = new ethers.Contract(VOUCHER_ADDRESS, voucherInterface, wallet);

    // Send the transaction
    const tx = await voucherContract.transferFrom(wallet.address, TIMELOCK_ADDRESS, strategyId, { gasLimit: 1000000 }); // Adjust gas limit as needed

    console.log('Transfer strategy transaction sent:', tx.hash);

    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    console.log('Transfer strategy transaction receipt:', receipt);

  } catch (error) {
    console.error('Error transferring strategy:', error);
  }
}

program
  .command('transfer-strategy <strategyId>')
  .description('Transfer a strategy to the timelock contract')
  .action(async (strategyId) => {
    await transferStrategy(strategyId);
  });

program.parse(process.argv);
