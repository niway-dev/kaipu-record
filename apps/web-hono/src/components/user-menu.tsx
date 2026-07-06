import { Link } from "@tanstack/react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button,
} from "@kaipu/web-ui";
import { useTranslations } from "@kaipu/i18n";
import { useSignOut } from "@/hooks/use-session";
import type { AuthSession } from "@/lib/auth/types";

interface UserMenuProps {
  userName: AuthSession["user"]["name"];
  userEmail: AuthSession["user"]["email"];
  isAuthenticated: boolean;
}

export default function UserMenu({ userName, userEmail, isAuthenticated }: UserMenuProps) {
  const signOut = useSignOut();
  const t = useTranslations("auth");

  if (!isAuthenticated) {
    return (
      <Link to="/auth/login">
        <Button variant="outline">{t("signIn")}</Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>{userName}</DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card min-w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("myAccount")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{userEmail}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => signOut.mutate()}>
            {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
