import { createClient } from '@/lib/supabase/server'
import { NewProjectForm } from '@/components/admin/NewProjectForm'

export default async function NewProjectPage() {
  const supabase = await createClient()
  const { data: clients } = await supabase.from('clients').select('id, name').order('name')

  return (
    <div className="max-w-lg">
      <h1 className="text-[15px] font-medium text-ink mb-6">New project</h1>
      <NewProjectForm clients={clients ?? []} />
    </div>
  )
}
