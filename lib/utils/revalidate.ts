import { revalidatePath } from 'next/cache'

export function revalidateProjectScreens(projectId: string) {
  revalidatePath('/admin/projects')
  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/admin/projects/[id]', 'page')
  revalidatePath('/admin/today')
  revalidatePath('/app/widget')
}
