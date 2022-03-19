import 'reflect-metadata';
import { container } from 'tsyringe';

import client, { Client } from './struct/Client';

container.register(Client, { useValue: client });

await client.init(process.env.TOKEN!);
