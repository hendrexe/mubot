/** Prints an invite link with exactly the permissions the bot needs. */
import { OAuth2Scopes, PermissionsBitField } from 'discord.js';
import { env } from '../config/env';
import { INVITE_PERMISSIONS } from '../modules/tempVoice/permissions';

const url = new URL('https://discord.com/oauth2/authorize');
url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
url.searchParams.set(
  'permissions',
  new PermissionsBitField(INVITE_PERMISSIONS).bitfield.toString(),
);
url.searchParams.set('scope', [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '));

console.log(url.toString());
