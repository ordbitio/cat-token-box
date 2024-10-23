import { Module } from '@nestjs/common';
import { ConfigService } from '../providers/configService';
import { WalletService } from '../providers/walletService';
import { SpendService } from '../providers/spendService';

@Module({
  imports: [],
  providers: [ConfigService, WalletService, SpendService],
})
export class OrdbitModule {}
