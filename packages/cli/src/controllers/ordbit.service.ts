import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import {
  MinterType,
  getUtxos,
  OpenMinterTokenInfo,
  checkTokenInfo,
  btc,
  isOpenMinter,
  getTokenMinterCount,
  getTokenMinter,
  sleep,
  needRetry,
  TokenMetadata,
  getTokens,
  broadcast,
  unScaleByDecimals,
  OpenMinterContract,
  toP2tr,
  scaleByDecimals,
} from 'src/common';

import { deploy, getMinterInitialTxState } from '../commands/deploy/ft';
import { OpenMinterV2 } from '@cat-protocol/cat-smartcontracts';
import { BoardcastCommandOptions } from 'src/commands/boardcast.command';
import {
  addTokenMetadata,
  findTokenMetadataById,
  scaleConfig,
} from 'src/token';
import { getRemainSupply, openMint } from 'src/commands/mint/ft.open-minter';
import Decimal from 'decimal.js';
import { isMergeTxFail, mergeTokens } from 'src/commands/send/merge';
import { pick, pickLargeFeeUtxo } from 'src/commands/send/pick';
import { sendToken } from 'src/commands/send/ft';
import {
  ICat20DeployPayload,
  ICat20MintPayload,
  ICat20TransferPayload,
} from './interface';

@Injectable()
export class OrdbitService {
  private readonly logger = new Logger(OrdbitService.name, { timestamp: true });

  constructor(
    protected readonly spendService: SpendService,
    protected readonly walletService: WalletService,
    protected readonly configService: ConfigService,
  ) {
    const wallet = this.walletService.loadWallet();

    const error = this.configService.loadCliConfig('config.json');

    if (error instanceof Error) {
      this.logger.warn('WARNING:', error.message);
    }
  }

  async deployCat20({ token, feeRate }: ICat20DeployPayload) {
    try {
      this.logger.log('deploying cat-20', token, feeRate);

      this.logger.log('getting wallet addrss');
      const address = await this.walletService.getAddress();
      this.logger.log('got wallet address', address);

      this.logger.log('checking token info');
      const err = checkTokenInfo(token);

      if (err instanceof Error) {
        this.logger.error('Invalid token metadata!', err);
        return null;
      }

      this.logger.log('getting utxos');
      const utxos = await getUtxos(
        this.configService,
        this.walletService,
        address,
      );

      this.logger.log('got utxos', utxos);

      if (utxos.length === 0) {
        this.logger.error('Insufficient satoshi balance!');
        return null;
      }

      Object.assign(token, {
        minterMd5: OpenMinterV2.getArtifact().md5,
      });

      this.logger.log('deploying token', { token, feeRate, utxos });

      const result: {
        genesisTx: btc.Transaction;
        revealTx: btc.Transaction;
        tokenId: string;
        tokenAddr: string;
        minterAddr: string;
      } = await deploy(
        token as OpenMinterTokenInfo,
        feeRate,
        utxos,
        MinterType.OPEN_MINTER_V2,
        this.walletService,
        this.configService,
      );

      this.logger.log('deploy cat-20 result', result);

      if (!result) {
        this.logger.error(`deploying Token ${token.name} failed!`);
        return null;
      }

      if (!result) {
        console.log(`deploying Token ${token.name} failed!`);
        return;
      }

      this.spendService.updateTxsSpends([result.genesisTx, result.revealTx]);

      console.log(`Token ${token.symbol} has been deployed.`);
      console.log(`TokenId: ${result.tokenId}`);
      console.log(`Genesis txid: ${result.genesisTx.id}`);
      console.log(`Reveal txid: ${result.revealTx.id}`);

      const metadata = addTokenMetadata(
        this.configService,
        result.tokenId,
        token,
        result.tokenAddr,
        result.minterAddr,
        result.genesisTx.id,
        result.revealTx.id,
      );

      // auto premine
      if (token.premine > 0n) {
        if (result.genesisTx.outputs.length === 3) {
          const minter: OpenMinterContract = {
            utxo: {
              txId: result.revealTx.id,
              script: result.revealTx.outputs[1].script.toHex(),
              satoshis: result.revealTx.outputs[1].satoshis,
              outputIndex: 1,
            },
            state: getMinterInitialTxState(toP2tr(metadata.tokenAddr), token),
          };

          const scalePremine = scaleByDecimals(token.premine, token.decimals);

          const mintTxId = await openMint(
            this.configService,
            this.walletService,
            this.spendService,
            feeRate,
            [
              {
                txId: result.genesisTx.id,
                script: result.genesisTx.outputs[2].script.toHex(),
                satoshis: result.genesisTx.outputs[2].satoshis,
                outputIndex: 2,
              },
            ],
            metadata,
            2,
            minter,
            scalePremine,
          );

          if (mintTxId instanceof Error) {
            this.logger.error(`minting premine tokens failed!`, mintTxId);
            return null;
          }

          this.logger.error(
            `Minting ${token.premine} ${token.symbol} as premine in txId: ${mintTxId}`,
          );
        } else {
          this.logger.warn(`Insufficient satoshis to premine`, new Error());
        }
      }

      return result;
    } catch (e) {
      this.logger.error('deploy failed!', e);
      return null;
    }
  }

  getRandomInt(max: number) {
    this.logger.log('getting random int', max);
    return Math.floor(Math.random() * max);
  }

  async mintCat20({ options, data }: ICat20MintPayload) {
    try {
      this.logger.log('minting cat-20', { options, data });

      this.logger.log('getting wallet address');
      const address = this.walletService.getAddress();
      this.logger.log('got wallet address', address);

      this.logger.log('finding token metadata by id', { id: options.id });
      const token = await findTokenMetadataById(this.configService, options.id);
      this.logger.log('found token metadata', token);

      if (!token) {
        this.logger.error(`No token found for tokenId: ${options.id}`);
        return null;
      }

      if (!isOpenMinter(token.info.minterMd5)) {
        this.logger.error('unkown minter!');
        throw new Error('unkown minter!');
      }

      const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo);

      let amount: bigint | undefined = BigInt(options.amount);

      const feeRate = data.feeRate;
      this.logger.log('getting fee utxos', feeRate);
      const feeUtxos = await this.getFeeUTXOs(address);
      this.logger.log('got fee utxos', feeUtxos);
      if (feeUtxos.length === 0) {
        this.logger.error('Insufficient satoshis balance!');
        return null;
      }

      this.logger.log('getting token minter count', token.tokenId);
      const count = await getTokenMinterCount(
        this.configService,
        token.tokenId,
      );
      this.logger.log('got token minter count', count);

      const offset = this.getRandomInt(count - 1);
      this.logger.log('getting token minter', token, offset);
      const minter = await getTokenMinter(
        this.configService,
        this.walletService,
        token,
        offset,
      );
      this.logger.log('got token minter', minter);

      const minterState = minter.state.data;
      if (minterState.isPremined && amount > scaledInfo.limit) {
        this.logger.error('The number of minted tokens exceeds the limit!');
        return null;
      }

      const limit = scaledInfo.limit;

      if (!minter.state.data.isPremined && scaledInfo.premine > 0n) {
        if (typeof amount === 'bigint') {
          if (amount !== scaledInfo.premine) {
            throw new Error(
              `first mint amount should equal to premine ${scaledInfo.premine}`,
            );
          }
        } else {
          amount = scaledInfo.premine;
        }
      } else {
        amount = amount || limit;
        if (token.info.minterMd5 === MinterType.OPEN_MINTER_V1) {
          if (
            getRemainSupply(minter.state.data, token.info.minterMd5) < limit
          ) {
            this.logger.warn(`retry to mint token [${token.info.symbol}] ...`);
          }
          amount =
            amount > getRemainSupply(minter.state.data, token.info.minterMd5)
              ? getRemainSupply(minter.state.data, token.info.minterMd5)
              : amount;
        } else if (
          token.info.minterMd5 == MinterType.OPEN_MINTER_V2 &&
          amount != limit
        ) {
          this.logger.warn(
            `can only mint at the exactly amount of ${limit} at once`,
          );
          amount = limit;
        }
      }

      this.logger.log('opening mint', {
        feeRate,
        feeUtxos,
        token,
        minter,
        amount,
      });
      const mintTxIdOrErr = await openMint(
        this.configService,
        this.walletService,
        this.spendService,
        feeRate,
        feeUtxos,
        token,
        2,
        minter,
        amount,
      );

      this.logger.log('minted cat-20', mintTxIdOrErr);

      if (mintTxIdOrErr instanceof Error) {
        this.logger.error('mint failed!', mintTxIdOrErr);
        return null;
      }
      this.logger.log('minted cat-20 final resp', mintTxIdOrErr);
      return mintTxIdOrErr;
    } catch (error) {
      this.logger.error('mint failed!', error);
      return null;
    }
  }

  async getFeeUTXOs(address: btc.Address) {
    this.logger.log('getting fee utxos', address);
    try {
      let feeUtxos = await getUtxos(
        this.configService,
        this.walletService,
        address,
      );

      this.logger.log('got fee utxos', feeUtxos);
      feeUtxos = feeUtxos.filter((utxo) => {
        return this.spendService.isUnspent(utxo);
      });

      if (feeUtxos.length === 0) {
        this.logger.warn('Insufficient satoshis balance!');
        return [];
      }

      this.logger.log('returning fee utxos', feeUtxos);
      return feeUtxos;
    } catch (error) {
      this.logger.error('get fee utxos failed!', error);
      return null;
    }
  }

  async transferCat20({ options, data }: ICat20TransferPayload) {
    try {
      this.logger.log('transferring cat-20', { options, data });
      const address = this.walletService.getAddress();
      const token = await findTokenMetadataById(this.configService, options.id);

      if (!token) {
        this.logger.error(`No token found for tokenId: ${options.id}`);
        throw new Error(`No token metadata found for tokenId: ${options.id}`);
      }

      let receiver: btc.Address;
      let amount: bigint;
      try {
        receiver = btc.Address.fromString(data.receiver);

        if (receiver.type !== 'taproot') {
          this.logger.error(`Invalid address type: ${receiver.type}`);
          return null;
        }
      } catch (error) {
        this.logger.error(`Invalid receiver address: "${data.receiver}" `);
        return null;
      }

      const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo);

      try {
        const d = new Decimal(data.amount).mul(
          Math.pow(10, scaledInfo.decimals),
        );
        amount = BigInt(d.toString());
      } catch (error) {
        this.logger.error(`Invalid amount: "${data.amount}"`, error);
        return null;
      }

      try {
        await this.send(token, receiver, amount, address, data.feeRate);
      } catch (error) {
        // if merge failed, we can auto retry
        if (isMergeTxFail(error)) {
          this.logger.error(
            `Merge [${token.info.symbol}] tokens failed.`,
            error,
          );
          this.logger.warn(`retry to merge [${token.info.symbol}] tokens ...`);
          await sleep(6);
          // continue;
        }

        if (needRetry(error)) {
          throw error;
        }
      }
    } catch (error) {
      this.logger.error('transfer failed!', error);
      return null;
    }
  }

  async send(
    token: TokenMetadata,
    receiver: btc.Address,
    amount: bigint,
    address: btc.Address,
    feeRate: number,
  ) {
    try {
      let feeUtxos = await getUtxos(
        this.configService,
        this.walletService,
        address,
      );

      feeUtxos = feeUtxos.filter((utxo) => {
        return this.spendService.isUnspent(utxo);
      });

      if (feeUtxos.length === 0) {
        this.logger.warn('Insufficient satoshis balance!');
        return null;
      }

      const res = await getTokens(
        this.configService,
        this.spendService,
        token,
        address,
      );

      if (res === null) {
        return null;
      }

      const { contracts } = res;

      let tokenContracts = pick(contracts, amount);

      if (tokenContracts.length === 0) {
        this.logger.warn('Insufficient token balance!');
        return null;
      }

      const cachedTxs: Map<string, btc.Transaction> = new Map();
      if (tokenContracts.length > 4) {
        this.logger.log(`Merging your [${token.info.symbol}] tokens ...`);
        const [mergedTokens, newfeeUtxos, e] = await mergeTokens(
          this.configService,
          this.walletService,
          this.spendService,
          feeUtxos,
          feeRate,
          token,
          tokenContracts,
          address,
          cachedTxs,
        );

        if (e instanceof Error) {
          this.logger.error('merge token failed!', e);
          return null;
        }

        tokenContracts = mergedTokens;
        feeUtxos = newfeeUtxos;
      }

      const feeUtxo = pickLargeFeeUtxo(feeUtxos);

      const result = await sendToken(
        this.configService,
        this.walletService,
        feeUtxo,
        feeRate,
        token,
        tokenContracts,
        address,
        receiver,
        amount,
        cachedTxs,
      );

      if (result) {
        const commitTxId = await broadcast(
          this.configService,
          this.walletService,
          result.commitTx.uncheckedSerialize(),
        );

        if (commitTxId instanceof Error) {
          throw commitTxId;
        }

        this.spendService.updateSpends(result.commitTx);

        const revealTxId = await broadcast(
          this.configService,
          this.walletService,
          result.revealTx.uncheckedSerialize(),
        );

        if (revealTxId instanceof Error) {
          return null;
        }

        this.spendService.updateSpends(result.revealTx);

        this.logger.log(
          `Sending ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens to ${receiver} \nin txid: ${result.revealTx.id}`,
        );
      }
    } catch (e) {
      this.logger.error('transfer failed!', e);
      return null;
    }
  }
}
