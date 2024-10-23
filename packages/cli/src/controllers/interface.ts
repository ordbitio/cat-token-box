import { BoardcastCommandOptions } from 'src/commands/boardcast.command';
import { OpenMinterTokenInfo } from 'src/common';

export interface ICat20DeployPayload {
  token: OpenMinterTokenInfo;
  feeRate: number;
}

export interface MintCommandOptions extends BoardcastCommandOptions {
  id: string;
  merge: boolean;
  new?: number;
  amount: number;
}

export interface ICat20MintPayload {
  options: MintCommandOptions;
  data: { feeRate: number };
}

export interface ICat20TransferPayload {
  options: MintCommandOptions;
  data: { feeRate: number; receiver: string; amount: number };
}
