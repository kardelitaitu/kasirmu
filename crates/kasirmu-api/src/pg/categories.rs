//! Category serving layer for the cloud Postgres replica.

use deadpool_postgres::Pool;

use kasirmu_core::Category;

use super::PgError;

/// List all categories, ordered by name.
pub async fn list_categories(pool: &Pool) -> Result<Vec<Category>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            "SELECT id, name, colour, icon FROM categories ORDER BY name",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    rows.iter()
        .map(|r| {
            Ok(Category {
                id: r.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
                name: r.try_get("name").map_err(|e| PgError::Db(e.to_string()))?,
                colour: r
                    .try_get("colour")
                    .map_err(|e| PgError::Db(e.to_string()))?,
                icon: r.try_get("icon").map_err(|e| PgError::Db(e.to_string()))?,
            })
        })
        .collect()
}
