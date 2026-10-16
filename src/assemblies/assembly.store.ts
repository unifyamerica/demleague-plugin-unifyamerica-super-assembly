import { Injectable } from '@nestjs/common';
import {
  DataProxy,
  MAX_QUERY_LIMIT,
  type PluginCollection,
  type PluginFilter,
  type PluginRecord,
} from '@unifyamerica/demleague-plugin-sdk';
import {
  COLLECTIONS,
  type Assembly,
  type Invitation,
  type Participant,
  type StoredResponse,
} from './assembly.interface';

// Every collection is the current organization's: the host scopes each call to the request's tenant
@Injectable()
export class AssemblyStore {
  constructor(private readonly data: DataProxy) {}

  get assemblies(): PluginCollection<Assembly> {
    return this.data.collection<Assembly>(COLLECTIONS.ASSEMBLIES);
  }
  get invitations(): PluginCollection<Invitation> {
    return this.data.collection<Invitation>(COLLECTIONS.INVITATIONS);
  }
  get participants(): PluginCollection<Participant> {
    return this.data.collection<Participant>(COLLECTIONS.PARTICIPANTS);
  }
  get responses(): PluginCollection<StoredResponse> {
    return this.data.collection<StoredResponse>(COLLECTIONS.RESPONSES);
  }

  /** Every matching record, a page of 100 at a time, oldest first. */
  async all<T extends object>(
    collection: PluginCollection<T>,
    filter: PluginFilter,
  ): Promise<PluginRecord<T>[]> {
    const records: PluginRecord<T>[] = [];
    for (let skip = 0; ; skip += MAX_QUERY_LIMIT) {
      const page = await collection.find({
        filter,
        sort: { createdAt: 1 },
        limit: MAX_QUERY_LIMIT,
        skip,
      });
      records.push(...page.items);
      if (page.items.length < MAX_QUERY_LIMIT) return records;
    }
  }
}
