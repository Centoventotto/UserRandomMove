/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    ChannelStore,
    GuildChannelStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    showToast,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

const logger = new Logger("UserRandomMove");

/** How many times the user is moved through every available voice channel. */
const ROUNDS = 2;

const settings = definePluginSettings({
    delay: {
        type: OptionType.NUMBER,
        description: "Delay between each move, in milliseconds (lower values may hit Discord rate limits).",
        default: 1000
    },
    returnToOriginalChannel: {
        type: OptionType.BOOLEAN,
        description: "Move the user back to the voice channel they were in once finished.",
        default: true
    }
});

/** Users that currently have a Random Move in progress, mapped to the run token. Deleting an entry stops the run. */
const activeMoves = new Map<string, symbol>();

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function canMoveInto(channel: Channel) {
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
        && PermissionStore.can(PermissionsBits.CONNECT, channel)
        && PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
}

/** Voice channels of the guild, other than `excludeId`, that the current user can move members into. */
function getMovableChannels(guildId: string, excludeId: string) {
    return GuildChannelStore.getChannels(guildId).VOCAL
        .map(({ channel }) => channel)
        .filter(channel => channel.type === ChannelType.GUILD_VOICE && channel.id !== excludeId && canMoveInto(channel));
}

/**
 * Builds the move order: every channel once per round, each round shuffled,
 * without ever moving the user into the channel they are already in.
 */
function buildMoveSequence(channels: Channel[]) {
    const sequence: Channel[] = [];

    for (let round = 0; round < ROUNDS; round++) {
        const order = shuffle(channels);
        if (order.length > 1 && order[0].id === sequence.at(-1)?.id) {
            const swapIndex = 1 + Math.floor(Math.random() * (order.length - 1));
            [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
        }
        sequence.push(...order);
    }

    return sequence;
}

function getRetryAfter(error: unknown): number | null {
    const err = error as { status?: number; body?: { retry_after?: number; }; };
    if (err?.status !== 429) return null;
    return typeof err.body?.retry_after === "number" ? err.body.retry_after * 1000 : 1000;
}

async function moveMember(guildId: string, userId: string, channelId: string) {
    const request = () => RestAPI.patch({
        url: `/guilds/${guildId}/members/${userId}`,
        body: { channel_id: channelId }
    });

    try {
        await request();
    } catch (error) {
        const retryAfter = getRetryAfter(error);
        if (retryAfter === null) throw error;

        await sleep(retryAfter);
        await request();
    }
}

function isStillInGuildVoice(userId: string, guildId: string) {
    const channelId = VoiceStateStore.getVoiceStateForUser(userId)?.channelId;
    return !!channelId && ChannelStore.getChannel(channelId)?.guild_id === guildId;
}

async function randomMove(user: User, guildId: string, originalChannelId: string) {
    const channels = getMovableChannels(guildId, originalChannelId);
    if (!channels.length) {
        showToast("There are no other voice channels you can move this user into.", "failure");
        return;
    }

    const sequence = buildMoveSequence(channels);
    const name = user.globalName ?? user.username;

    const token = Symbol(user.id);
    const isActive = () => activeMoves.get(user.id) === token;
    activeMoves.set(user.id, token);
    showToast(`Random Move started for ${name} (${sequence.length} moves).`, "message");

    try {
        for (const channel of sequence) {
            if (!isActive()) {
                showToast(`Random Move stopped for ${name}.`, "message");
                return;
            }

            if (!isStillInGuildVoice(user.id, guildId)) {
                showToast(`${name} left the voice channel, Random Move stopped.`, "message");
                return;
            }

            await moveMember(guildId, user.id, channel.id);
            await sleep(Math.max(0, settings.store.delay));
        }

        if (settings.store.returnToOriginalChannel && isActive() && isStillInGuildVoice(user.id, guildId)) {
            const original = ChannelStore.getChannel(originalChannelId);
            if (original && canMoveInto(original)) await moveMember(guildId, user.id, originalChannelId);
        }

        showToast(`Random Move finished for ${name}.`, "success");
    } catch (error) {
        logger.error("Failed to move user", error);
        showToast(`Random Move failed for ${name}.`, "failure");
    } finally {
        if (isActive()) activeMoves.delete(user.id);
    }
}

interface UserContextProps {
    user?: User;
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!user || !currentUserId || user.id === currentUserId) return;

    // Only shown while you are connected to a voice channel
    if (!VoiceStateStore.getVoiceStateForUser(currentUserId)?.channelId) return;

    const targetChannelId = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
    const targetChannel = targetChannelId ? ChannelStore.getChannel(targetChannelId) : null;
    if (!targetChannel?.guild_id) return;
    if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, targetChannel)) return;

    const isRunning = activeMoves.has(user.id);
    if (!isRunning && !getMovableChannels(targetChannel.guild_id, targetChannel.id).length) return;

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-user-random-move"
            label={isRunning ? "Stop Random Move" : "Random Move"}
            color={isRunning ? "danger" : undefined}
            action={() => {
                if (isRunning) activeMoves.delete(user.id);
                else randomMove(user, targetChannel.guild_id, targetChannel.id);
            }}
        />
    );
};

export default definePlugin({
    name: "UserRandomMove",
    description: "Adds a \"Random Move\" button to the context menu of users in voice, which moves them in a random order through every voice channel you can move members into, twice.",
    tags: ["Voice", "Servers"],
    authors: [{ name: "centoventotto", id: 838808975558311948n }],
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    stop() {
        activeMoves.clear();
    }
});
