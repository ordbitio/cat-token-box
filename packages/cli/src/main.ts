import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { logerror } from './common';
import { ordbitserver } from './ordbitmain';

export async function bootstrap() {
  try {
    ordbitserver();
    // await CommandFactory.run(AppModule);
  } catch (error) {
    logerror('bootstrap failed!', error);
  }
}

if (require.main === module) {
  bootstrap();
}
