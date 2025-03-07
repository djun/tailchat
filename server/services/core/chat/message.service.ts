import moment from 'moment';
import { Types } from 'mongoose';
import type {
  MessageDocument,
  MessageModel,
} from '../../../models/chat/message';
import {
  TcService,
  TcDbService,
  GroupBaseInfo,
  TcContext,
  DataNotFoundError,
  NoPermissionError,
  call,
  PERMISSION,
} from 'tailchat-server-sdk';
import type { Group } from '../../../models/group/group';
import { isValidStr } from '../../../lib/utils';

interface MessageService
  extends TcService,
    TcDbService<MessageDocument, MessageModel> {}
class MessageService extends TcService {
  get serviceName(): string {
    return 'chat.message';
  }

  onInit(): void {
    this.registerLocalDb(require('../../../models/chat/message').default);

    this.registerAction('fetchConverseMessage', this.fetchConverseMessage, {
      params: {
        converseId: 'string',
        startId: { type: 'string', optional: true },
      },
    });
    this.registerAction('fetchNearbyMessage', this.fetchNearbyMessage, {
      params: {
        converseId: 'string',
        messageId: 'string',
        num: { type: 'number', optional: true },
      },
    });
    this.registerAction('sendMessage', this.sendMessage, {
      params: {
        converseId: 'string',
        groupId: [{ type: 'string', optional: true }],
        content: 'string',
        meta: { type: 'any', optional: true },
      },
    });
    this.registerAction('recallMessage', this.recallMessage, {
      params: {
        messageId: 'string',
      },
    });
    this.registerAction('deleteMessage', this.deleteMessage, {
      params: {
        messageId: 'string',
      },
    });
    this.registerAction(
      'fetchConverseLastMessages',
      this.fetchConverseLastMessages,
      {
        params: {
          converseIds: 'array',
        },
      }
    );
    this.registerAction('addReaction', this.addReaction, {
      params: {
        messageId: 'string',
        emoji: 'string',
      },
    });
    this.registerAction('removeReaction', this.removeReaction, {
      params: {
        messageId: 'string',
        emoji: 'string',
      },
    });
  }

  /**
   * 获取会话消息
   */
  async fetchConverseMessage(
    ctx: TcContext<{
      converseId: string;
      startId?: string;
    }>
  ) {
    const { converseId, startId } = ctx.params;
    const docs = await this.adapter.model.fetchConverseMessage(
      converseId,
      startId ?? null
    );

    return this.transformDocuments(ctx, {}, docs);
  }

  /**
   * 获取一条消息附近的消息
   * 以会话为准
   *
   * 额外需要converseId是为了防止暴力查找
   */
  async fetchNearbyMessage(
    ctx: TcContext<{
      converseId: string;
      messageId: string;
      num?: number;
    }>
  ) {
    const { converseId, messageId, num = 5 } = ctx.params;
    const { t } = ctx.meta;
    const message = await this.adapter.model
      .findOne({
        _id: new Types.ObjectId(messageId),
        converseId: new Types.ObjectId(converseId),
      })
      .limit(1)
      .exec();

    if (!message) {
      return new DataNotFoundError(t('没有找到消息'));
    }

    const [prev, next] = await Promise.all([
      this.adapter.model
        .find({
          _id: {
            $lt: new Types.ObjectId(messageId),
          },
          converseId: new Types.ObjectId(converseId),
        })
        .sort({ _id: -1 })
        .limit(num)
        .exec()
        .then((arr) => arr.reverse()),
      this.adapter.model
        .find({
          _id: {
            $gt: new Types.ObjectId(messageId),
          },
          converseId: new Types.ObjectId(converseId),
        })
        .sort({ _id: 1 })
        .limit(num)
        .exec(),
    ]);

    console.log({ prev, next });

    return this.transformDocuments(ctx, {}, [...prev, message, ...next]);
  }

  /**
   * 发送普通消息
   */
  async sendMessage(
    ctx: TcContext<{
      converseId: string;
      groupId?: string;
      content: string;
      meta?: object;
    }>
  ) {
    const { converseId, groupId, content, meta } = ctx.params;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    /**
     * 鉴权
     */
    if (isValidStr(groupId)) {
      // 是群组消息
      const groupInfo: Group = await ctx.call('group.getGroupInfo', {
        groupId,
      });
      const member = groupInfo.members.find((m) => String(m.userId) === userId);
      if (member) {
        // 因为有机器人，所以如果没有在成员列表中找到不报错

        if (new Date(member.muteUntil).valueOf() > new Date().valueOf()) {
          throw new Error(t('您因为被禁言无法发送消息'));
        }
      }
    }

    const message = await this.adapter.insert({
      converseId: new Types.ObjectId(converseId),
      groupId:
        typeof groupId === 'string' ? new Types.ObjectId(groupId) : undefined,
      author: new Types.ObjectId(userId),
      content,
      meta,
    });

    const json = await this.transformDocuments(ctx, {}, message);

    this.roomcastNotify(ctx, converseId, 'add', json);

    ctx.emit('chat.message.updateMessage', {
      type: 'add',
      groupId: String(groupId),
      converseId: String(converseId),
      messageId: String(message._id),
      content,
      meta: meta ?? {},
    });

    return json;
  }

  /**
   * 撤回消息
   */
  async recallMessage(ctx: TcContext<{ messageId: string }>) {
    const { messageId } = ctx.params;
    const { t, userId } = ctx.meta;

    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }

    if (message.hasRecall === true) {
      throw new Error(t('该消息已被撤回'));
    }

    // 消息撤回限时
    if (
      moment().valueOf() - moment(message.createdAt).valueOf() >
      15 * 60 * 1000
    ) {
      throw new Error(t('无法撤回 {{minutes}} 分钟前的消息', { minutes: 15 }));
    }

    let allowToRecall = false;

    //#region 撤回权限检查
    const groupId = message.groupId;
    if (groupId) {
      // 是一条群组信息
      const group: GroupBaseInfo = await ctx.call('group.getGroupBasicInfo', {
        groupId: String(groupId),
      });
      if (String(group.owner) === userId) {
        allowToRecall = true; // 是管理员 允许修改
      }
    }

    if (String(message.author) === String(userId)) {
      // 撤回者是消息所有者
      allowToRecall = true;
    }

    if (allowToRecall === false) {
      throw new NoPermissionError(t('撤回失败, 没有权限'));
    }
    //#endregion

    const converseId = String(message.converseId);
    message.hasRecall = true;
    await message.save();

    const json = await this.transformDocuments(ctx, {}, message);

    this.roomcastNotify(ctx, converseId, 'update', json);
    ctx.emit('chat.message.updateMessage', {
      type: 'recall',
      groupId: String(groupId),
      converseId: String(converseId),
      messageId: String(message._id),
      meta: message.meta ?? {},
    });

    return json;
  }

  /**
   * 删除消息
   * 仅支持群组
   */
  async deleteMessage(ctx: TcContext<{ messageId: string }>) {
    const { messageId } = ctx.params;
    const { t, userId } = ctx.meta;

    const message = await this.adapter.model.findById(messageId);
    if (!message) {
      throw new DataNotFoundError(t('该消息未找到'));
    }

    const groupId = message.groupId;
    if (!groupId) {
      throw new Error(t('无法删除私人信息'));
    }

    const [hasPermission] = await call(ctx).checkUserPermissions(
      String(groupId),
      userId,
      [PERMISSION.core.deleteMessage]
    );

    if (!hasPermission) {
      throw new NoPermissionError(t('没有删除权限')); // 仅管理员允许删除
    }

    const converseId = String(message.converseId);
    await this.adapter.removeById(messageId); // TODO: 考虑是否要改为软删除

    this.roomcastNotify(ctx, converseId, 'delete', { converseId, messageId });
    ctx.emit('chat.message.updateMessage', {
      type: 'delete',
      groupId: String(groupId),
      converseId: String(converseId),
      messageId: String(message._id),
      meta: message.meta ?? {},
    });

    return true;
  }

  /**
   * 基于会话id获取会话最后一条消息的id
   */
  async fetchConverseLastMessages(ctx: TcContext<{ converseIds: string[] }>) {
    const { converseIds } = ctx.params;

    // 这里使用了多个请求，但是通过limit=1会将查询范围降低到最低
    // 这种方式会比用聚合操作实际上更加节省资源
    const list = await Promise.all(
      converseIds.map((id) => {
        return this.adapter.model
          .findOne(
            {
              converseId: new Types.ObjectId(id),
            },
            {
              _id: 1,
              converseId: 1,
            }
          )
          .sort({
            _id: -1,
          })
          .limit(1)
          .exec();
      })
    );

    return list.filter(Boolean).map((item) => ({
      converseId: String(item.converseId),
      lastMessageId: String(item._id),
    }));
  }

  async addReaction(
    ctx: TcContext<{
      messageId: string;
      emoji: string;
    }>
  ) {
    const { messageId, emoji } = ctx.params;
    const userId = ctx.meta.userId;

    const message = await this.adapter.model.findById(messageId);

    const appendReaction = {
      name: emoji,
      author: new Types.ObjectId(userId),
    };

    await this.adapter.model.updateOne(
      {
        _id: messageId,
      },
      {
        $push: {
          reactions: {
            ...appendReaction,
          },
        },
      }
    );

    const converseId = String(message.converseId);
    this.roomcastNotify(ctx, converseId, 'addReaction', {
      converseId,
      messageId,
      reaction: {
        ...appendReaction,
      },
    });

    return true;
  }

  async removeReaction(
    ctx: TcContext<{
      messageId: string;
      emoji: string;
    }>
  ) {
    const { messageId, emoji } = ctx.params;
    const userId = ctx.meta.userId;

    const message = await this.adapter.model.findById(messageId);

    const removedReaction = {
      name: emoji,
      author: new Types.ObjectId(userId),
    };

    await this.adapter.model.updateOne(
      {
        _id: messageId,
      },
      {
        $pull: {
          reactions: {
            ...removedReaction,
          },
        },
      }
    );

    const converseId = String(message.converseId);
    this.roomcastNotify(ctx, converseId, 'removeReaction', {
      converseId,
      messageId,
      reaction: {
        ...removedReaction,
      },
    });

    return true;
  }
}

export default MessageService;
