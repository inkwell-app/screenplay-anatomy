/** Original synthetic inputs, MIT. Generated in temporary directories by tests. */
export function record(scenes = 20) {
  return {
    movie_name: "PRIVATE_TITLE_SENTINEL",
    imdb_id: "PRIVATE_ID_SENTINEL",
    summary: "Three travelers cross an empty station together.",
    script: Array.from(
      { length: scenes },
      (_, i) =>
        `<scene><stage_direction>INT. STATION ${i} - DAY</stage_direction><scene_description>${"walk ".repeat(240)}</scene_description>${["ALPHA_SENTINEL", "BETA_SENTINEL", "GAMMA_SENTINEL"].map((name) => `<character>${name}</character><dialogue>${"hello ".repeat(20)}</dialogue>`).join("")}</scene>`,
    ).join(""),
  }
}
