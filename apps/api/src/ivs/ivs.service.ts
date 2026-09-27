import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteChannelCommand,
  DeleteStreamKeyCommand,
  GetStreamKeyCommand,
  IvsClient,
} from '@aws-sdk/client-ivs';

export type IvsChannel = {
  channelArn: string;
  streamKeyArn: string;
  playbackUrl: string;
  ingestEndpoint: string;
};

export type IvsStreamKey = {
  ingestEndpoint: string;
  streamKeyValue: string;
};

/**
 * Thin wrapper over @aws-sdk/client-ivs. One IVS channel per host, created
 * once (HostsService.becomeHost) and reused across streams — IVS channels
 * are a standing resource, not a per-stream one, same as the LiveKit
 * room-per-host pattern this replaces (see docs/MIGRATION_PLAN.md, Phase 3).
 */
@Injectable()
export class IvsService {
  private readonly client: IvsClient;

  constructor(private readonly config: ConfigService) {
    this.client = new IvsClient({ region: this.config.getOrThrow<string>('AWS_REGION') });
  }

  async createChannel(name: string): Promise<IvsChannel> {
    const res = await this.client.send(
      new CreateChannelCommand({
        name,
        type: 'STANDARD',
        latencyMode: 'LOW',
        authorized: false,
      }),
    );
    if (!res.channel?.arn || !res.channel.playbackUrl || !res.channel.ingestEndpoint || !res.streamKey?.arn) {
      throw new Error('IVS did not return a complete channel');
    }
    return {
      channelArn: res.channel.arn,
      streamKeyArn: res.streamKey.arn,
      playbackUrl: res.channel.playbackUrl,
      ingestEndpoint: res.channel.ingestEndpoint,
    };
  }

  /** Fetches the actual stream key value on demand — never persisted in plaintext. */
  async getStreamKeyValue(streamKeyArn: string): Promise<string> {
    const res = await this.client.send(new GetStreamKeyCommand({ arn: streamKeyArn }));
    if (!res.streamKey?.value) throw new Error('IVS stream key not found');
    return res.streamKey.value;
  }

  /** Rotates the stream key if a host's key leaks — old key stops working immediately. */
  async rotateStreamKey(channelArn: string, oldStreamKeyArn: string): Promise<string> {
    await this.client.send(new DeleteStreamKeyCommand({ arn: oldStreamKeyArn }));
    const res = await this.client.send(new CreateStreamKeyCommand({ channelArn }));
    if (!res.streamKey?.arn) throw new Error('IVS did not return a new stream key');
    return res.streamKey.arn;
  }

  async deleteChannel(channelArn: string): Promise<void> {
    await this.client.send(new DeleteChannelCommand({ arn: channelArn }));
  }
}
