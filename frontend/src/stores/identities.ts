import { defineStore } from 'pinia'

export type Team = { id:string; name:string; memberCount?:number }
export type Dev  = { id:string; name:string; teamId:string; primaryIDE?:'cursor'|'windsurf'|'vscode'|'jetbrains'|'sublime'|'vim' }

export const useIdentitiesStore = defineStore('identities', {
  state: () => ({
    teams: [
      { id:'team-a', name:'Product A Team', memberCount:2 },
      { id:'team-b', name:'Product B Team', memberCount:2 },
    ] as Team[],
    devs: [
      { id:'dev-a', name:'Developer A', teamId:'team-a', primaryIDE:'cursor'   },
      { id:'dev-b', name:'Developer B', teamId:'team-a', primaryIDE:'vscode'   },
      { id:'dev-c', name:'Developer C', teamId:'team-b', primaryIDE:'jetbrains' },
      { id:'dev-d', name:'Developer D', teamId:'team-b', primaryIDE:'sublime'   },
    ] as Dev[],
  }),
  getters:{
    devById:  s => (id:string) => s.devs.find(d=>d.id===id),
    teamById: s => (id:string) => s.teams.find(t=>t.id===id),
    devsByTeam: s => (teamId:string) => s.devs.filter(d=>d.teamId===teamId),
  },
})
