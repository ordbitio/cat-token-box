import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdbitService } from './ordbit.service';
import {
  ICat20DeployPayload,
  ICat20MintPayload,
  ICat20TransferPayload,
} from './interface';

@Controller('/v1')
export class OrdbitController {
  private readonly logger = new Logger(OrdbitService.name, { timestamp: true });

  constructor(private readonly ordbitService: OrdbitService) {}

  @Get()
  async healthCheck(@Res() res: Response) {
    this.logger.log('Health check');
    res.status(HttpStatus.CREATED).send('ok');
  }

  @Post('/cat20/deploy')
  async deployCat20(@Req() request: Request, @Res() res: Response) {
    try {
      const { token, feeRate } = request.body as unknown as ICat20DeployPayload;
      this.logger.log('rcvd request to deploy cat20 token', token, feeRate);
      const resp = await this.ordbitService.deployCat20({
        feeRate: feeRate,
        token: token,
      });
      this.logger.log('deploy cat20 resp', resp);
      if (resp === null) {
        this.logger.error('failed to deploy cat20');
        return res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ message: 'failed to deploy' });
      }

      res.status(HttpStatus.OK).json(resp);
    } catch (e) {}
  }

  @Post('cat20/mint')
  async mintCat20(@Req() request: Request, @Res() res: Response) {
    try {
      const { data, options } = request.body as unknown as ICat20MintPayload;
      this.logger.log('rcvd req to mint cat20', data, options);
      const resp = await this.ordbitService.mintCat20({
        options: { ...options, amount: options.amount },
        data,
      });
      this.logger.log('mint cat-20 resp', resp);

      if (resp === null) {
        this.logger.error('failed to mint cat20');
        return res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ message: 'failed to mint' });
      }
      res.status(HttpStatus.OK).json(resp);
    } catch (e) {}
  }

  @Post('cat20/transfer')
  async transferCat20(@Req() request: Request, @Res() res: Response) {
    try {
      const { data, options } =
        request.body as unknown as ICat20TransferPayload;
      this.logger.log('rcvd req to transfer cat20', data, options);
      const resp = await this.ordbitService.transferCat20({
        options: { ...options, amount: options.amount },
        data,
      });
      this.logger.log('transfer cat-20 resp', resp);
      if (resp === null) {
        this.logger.error('failed to transfer cat20');
        return res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ message: 'failed to transfer' });
      }
      res.status(HttpStatus.OK).json(resp);
    } catch (e) {
      this.logger.error('Error in transferCat20', e);
    }
  }
}
