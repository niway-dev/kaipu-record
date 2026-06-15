import {
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
  keepPreviousData,
} from "@tanstack/react-query";
import { orpc } from "@/lib/orpc-client";
import { listTodos } from "@/server-functions/list-todos";

interface TodosParams {
  page: number;
  limit: number;
}

export const todoKeys = {
  all: ["todos"] as const,
  list: (params?: TodosParams) => [...todoKeys.all, "list", params] as const,
  detail: (id: string) => [...todoKeys.all, "detail", id] as const,
};

export const todosQueryOptions = (params: TodosParams) =>
  queryOptions({
    queryKey: todoKeys.list(params),
    queryFn: () => listTodos({ data: { page: params.page, limit: params.limit } }),
    placeholderData: keepPreviousData,
  });

export const useTodos = (params: TodosParams) => {
  return useQuery(todosQueryOptions(params));
};

export const useTodo = (id: string) => {
  return useQuery({
    ...orpc.todo.get.queryOptions({ input: { id } }),
    queryKey: todoKeys.detail(id),
    enabled: !!id,
  });
};

export const useCreateTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.todo.create.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};

export const useUpdateTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.todo.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};

export const useDeleteTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.todo.delete.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};
