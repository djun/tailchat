import React, { useMemo } from 'react';
import { CommonSidebarWrapper } from '@/components/CommonSidebarWrapper';
import {
  chatActions,
  InboxItem,
  isValidStr,
  model,
  t,
  useAppDispatch,
  useAsyncRequest,
  useInboxList,
} from 'tailchat-shared';
import clsx from 'clsx';
import _orderBy from 'lodash/orderBy';
import { GroupName } from '@/components/GroupName';
import { ConverseName } from '@/components/ConverseName';
import { getMessageRender, pluginInboxItemMap } from '@/plugin/common';
import { useLocation } from 'react-router';
import { Link } from 'react-router-dom';
import { PillTabPane, PillTabs } from '@/components/PillTabs';
import { SectionHeader } from '@/components/SectionHeader';
import { openReconfirmModalP } from '@/components/Modal';

const buildLink = (itemId: string) => `/main/inbox/${itemId}`;

/**
 * 收件箱侧边栏组件
 */
export const InboxSidebar: React.FC = React.memo(() => {
  const inbox = useInboxList();
  const list = useMemo(() => _orderBy(inbox, 'createdAt', 'desc'), [inbox]);
  const dispatch = useAppDispatch();

  const renderInbox = (item: InboxItem) => {
    if (item.type === 'message') {
      const message: Partial<model.inbox.InboxItem['message']> =
        item.message ?? {};
      let title: React.ReactNode = '';
      if (isValidStr(message.groupId)) {
        title = <GroupName groupId={message.groupId} />;
      } else if (isValidStr(message.converseId)) {
        title = <ConverseName converseId={message.converseId} />;
      }

      return (
        <InboxSidebarItem
          key={item._id}
          title={title}
          desc={getMessageRender(message.messageSnippet ?? '')}
          source={'Tailchat'}
          readed={item.readed}
          to={buildLink(item._id)}
        />
      );
    } else if (pluginInboxItemMap[item.type]) {
      const info = pluginInboxItemMap[item.type];
      const preview = info.getPreview(item);

      return (
        <InboxSidebarItem
          key={item._id}
          title={preview.title}
          desc={preview.desc}
          source={info.source ?? 'Unknown'}
          readed={item.readed}
          to={buildLink(item._id)}
        />
      );
    }

    return null;
  };

  const fullList = list;
  const unreadList = list.filter((item) => item.readed === false);

  const [, handleAllAck] = useAsyncRequest(async () => {
    unreadList.forEach((item) => {
      dispatch(chatActions.setInboxItemAck(item._id));
    });

    await model.inbox.setInboxAck(unreadList.map((item) => item._id));
  }, [unreadList]);

  const [, handleClear] = useAsyncRequest(async () => {
    const res = await openReconfirmModalP({
      title: t('确认清空收件箱么?'),
    });
    if (res) {
      await model.inbox.clearInbox();
    }
  }, [unreadList]);

  return (
    <CommonSidebarWrapper data-tc-role="sidebar-inbox">
      <SectionHeader
        menu={{
          items: [
            {
              key: 'readAll',
              label: t('所有已读'),
              onClick: handleAllAck,
            },
            {
              key: 'clear',
              label: t('清空收件箱'),
              danger: true,
              onClick: handleClear,
            },
          ],
        }}
      >
        {t('收件箱')}
      </SectionHeader>

      <div className="overflow-hidden">
        <PillTabs>
          <PillTabPane key="1" tab={`${t('全部')}`}>
            {fullList.map((item) => renderInbox(item))}
          </PillTabPane>
          <PillTabPane key="2" tab={`${t('未读')} (${unreadList.length})`}>
            {unreadList.map((item) => renderInbox(item))}
          </PillTabPane>
        </PillTabs>
      </div>
    </CommonSidebarWrapper>
  );
});
InboxSidebar.displayName = 'InboxSidebar';

const InboxSidebarItem: React.FC<{
  title: React.ReactNode;
  desc: React.ReactNode;
  source: string;
  readed: boolean;
  to: string;
}> = React.memo((props) => {
  const location = useLocation();
  const isActive = location.pathname.startsWith(props.to);

  return (
    <Link to={props.to}>
      <div
        className={clsx(
          'p-2 overflow-auto cursor-pointer hover:bg-black hover:bg-opacity-10 dark:hover:bg-white dark:hover:bg-opacity-10 border-r-4 rounded',
          {
            'bg-black bg-opacity-10 dark:bg-white dark:bg-opacity-10': isActive,
          },
          props.readed ? 'border-transparent' : 'border-green-500'
        )}
      >
        <div className="text-lg overflow-ellipsis overflow-hidden text-gray-700 dark:text-white">
          {props.title || <span>&nbsp;</span>}
        </div>
        <div className="break-all text-opacity-80 text-black dark:text-opacity-80 dark:text-white text-sm p-1 border-l-2 border-gray-500 border-opacity-50">
          {props.desc}
        </div>
        <div className="text-xs text-opacity-50 text-black dark:text-opacity-50 dark:text-white">
          {t('来自')}: {props.source}
        </div>
      </div>
    </Link>
  );
});
InboxSidebarItem.displayName = 'InboxSidebarItem';
