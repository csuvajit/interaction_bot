import { Constants } from 'discord.js';
import { Listener } from '../lib';

export default class Ready extends Listener {
    public constructor() {
        super('ready', {
            emitter: 'client',
            event: Constants.Events.CLIENT_READY
        });
    }

    public exec() {
        console.log('Ready!');
    }
}
