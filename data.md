
| name   | Path        | Purpose                              |
| ------ | ----------- | ------------------------------------ |
| POST   | /api/query  | Generate SQL from prompt, execute it |
| GET    | /api/skills | Return loaded skill files            |
| GET    | /api/health | Health check                         |

## country shall be normalized, `dim_country`

The current data using short country code. then join with macro.dim_country. 
This make model hard to understand and cost more token. 

> Action: the final data shall use directory country name. All in low case. like "sweden

## `NULL` and `""`

currently we have the data be either NULL or empty string, which cause hard to do in sql. 

> Action: normalized to `""`? 

## dim_period

> TODO: need to figure out the usage pattern in the chart?

Q1 2021 format always in chart? 

## service_package_id

It's never used, so we will not include in the final data

## month, we never use month