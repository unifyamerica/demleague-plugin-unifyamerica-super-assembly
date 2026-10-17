import { Injectable } from '@nestjs/common';

/** The time, for the services and jobs (tests set it). */
@Injectable()
export class AssemblyClock {
  now(): Date {
    return new Date();
  }
}
