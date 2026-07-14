import * as chatsGeneral from "./chats/general";
import * as chatsDm from "./chats/dm";
import * as userProfile from "./user/profile";
import * as userAuth from "./user/auth";
import * as userDevices from "./user/devices";
import * as userSearch from "./user/search";
import * as cryptoPrekeys from "./crypto/prekeys";
import * as cryptoIdentity from "./crypto/identity";
import * as cryptoBackup from "./crypto/backup";
import * as moderationBlocklist from "./moderation/blocklist";
import * as moderationUsers from "./moderation/users";
import * as filesModule from "./files";
import * as pushModule from "./push";

const api = {
    chats: {
        general: chatsGeneral,
        dm: chatsDm
    },
    user: {
        profile: userProfile,
        auth: userAuth,
        devices: userDevices,
        search: userSearch
    },
    crypto: {
        prekeys: cryptoPrekeys,
        identity: cryptoIdentity,
        backup: cryptoBackup
    },
    moderation: {
        blocklist: moderationBlocklist,
        users: moderationUsers
    },
    files: filesModule,
    push: pushModule
};

export default api;

export const chats = api.chats;
export const user = api.user;
export const crypto = api.crypto;
export const moderation = api.moderation;
export const files = api.files;
export const push = api.push;

