import GroupOrderApp from "../../components/GroupOrderApp";

export default async function GroupPage({ params }) {
  const { id } = await params;
  return <GroupOrderApp initialNav={{ screen: "group", groupId: id, tab: "groups" }} />;
}
