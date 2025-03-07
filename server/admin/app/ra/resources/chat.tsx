import {
  BooleanField,
  Datagrid,
  DateField,
  List,
  TextField,
  SearchInput,
  useTranslate,
  BulkDeleteButton,
  ShowButton,
  EditButton,
  ReferenceInput,
  SelectInput,
} from 'react-admin';
import { GroupField } from '../components/GroupField';
import { PostListActionToolbar } from '../components/PostListActionToolbar';
import { UserField } from '../components/UserField';

export const MessageList: React.FC = () => {
  const translate = useTranslate();

  return (
    <List
      filters={[
        <SearchInput
          key="search"
          source="q"
          alwaysOn
          placeholder={translate('custom.users.search')}
        />,
        <ReferenceInput key="groupID" source="groupId" reference="groups">
          <SelectInput optionText="name" />
        </ReferenceInput>,
      ]}
    >
      <Datagrid
        rowClick="show"
        bulkActionButtons={<BulkDeleteButton mutationMode="optimistic" />}
      >
        <TextField source="id" sortable={true} sortByOrder="DESC" />
        <TextField source="content" />
        <UserField source="author" />
        <GroupField source="groupId" />
        <TextField source="converseId" />
        <BooleanField source="hasRecall" />
        <TextField source="reactions" />
        <DateField source="createdAt" />
        <PostListActionToolbar>
          <ShowButton />
        </PostListActionToolbar>
      </Datagrid>
    </List>
  );
};
MessageList.displayName = 'MessageList';
