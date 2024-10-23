import { NestFactory } from '@nestjs/core';
import { OrdbitModule } from './ordbit.module';
import { Logger } from '@nestjs/common';

export async function ordbitserver() {
  const logger = new Logger('ordbitserver');
  const PORT = 3000;

  logger.log(`Application is running on:`, PORT);
  try {
    const app = await NestFactory.create(OrdbitModule);
    await app.listen(PORT);
  } catch (error) {
    logger.error('ordbitserver failed!', error);
  }
}
