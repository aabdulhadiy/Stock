import { requireRole } from "@/lib/auth";
import { getUsersList, getShops } from "@/lib/queries";
import { roleLabel } from "@/lib/permissions";
import { Card, CardHeader, CardTitle, CardBody, Table, Th, Td, Badge } from "@/components/ui";
import { UserForm } from "@/components/user-form";
import { createUser, setUserActive } from "./actions";
import { Button } from "@/components/ui";

export default async function UsersPage() {
  const current = await requireRole("ADMIN");
  const [usersList, shops] = await Promise.all([getUsersList(), getShops()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-muted text-sm mt-1">Manage staff accounts and their roles.</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <Card className="lg:col-span-3">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Shop</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {usersList.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="text-muted">{u.email}</Td>
                  <Td>{roleLabel(u.role)}</Td>
                  <Td className="text-muted">{u.shopName ?? "—"}</Td>
                  <Td>
                    {u.isActive ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="red">Disabled</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {u.id !== current.sub && (
                      <form action={setUserActive.bind(null, u.id, !u.isActive)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {u.isActive ? "Disable" : "Enable"}
                        </Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Add user</CardTitle>
          </CardHeader>
          <CardBody>
            <UserForm action={createUser} shops={shops} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
