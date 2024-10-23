import { Module } from '@nestjs/common';
import { DeployCommand } from './commands/deploy/deploy.command';
import { MintCommand } from './commands/mint/mint.command';
import { SendCommand } from './commands/send/send.command';
import { WalletCommand } from './commands/wallet/wallet.command';
import { ConfigService, SpendService, WalletService } from './providers';
import { RetryQuestions } from './questions/retry-send.question';
import { VersionCommand } from './commands/version.command';
import { OrdbitController } from './controllers/ordbit.controller';
import { OrdbitService } from './controllers/ordbit.service';

@Module({
  imports: [OrdbitModule],
  controllers: [OrdbitController],
  providers: [
    WalletService,
    ConfigService,
    SpendService,
    VersionCommand,
    RetryQuestions,
    DeployCommand,
    MintCommand,
    OrdbitService,
  ],
})
export class OrdbitModule {}
