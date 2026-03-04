CREATE TABLE IF NOT EXISTS department (
    department_id   SERIAL PRIMARY KEY,
    name_department VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS program (
    program_id      SERIAL PRIMARY KEY,
    name_program    VARCHAR(200) NOT NULL,
    department_id   INT NOT NULL REFERENCES department(department_id),
    plan            INT NOT NULL  -- план набора (количество мест)
);

CREATE TABLE IF NOT EXISTS subject (
    subject_id   SERIAL PRIMARY KEY,
    name_subject VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollee (
    enrollee_id   SERIAL PRIMARY KEY,
    name_enrollee VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS achievement (
    achievement_id   SERIAL PRIMARY KEY,
    name_achievement VARCHAR(200) NOT NULL,
    bonus            INT NOT NULL  -- дополнительные баллы за достижение
);

-- Достижения абитуриентов (связь многие-ко-многим)
CREATE TABLE IF NOT EXISTS enrollee_achievement (
    enrollee_achiev_id SERIAL PRIMARY KEY,
    enrollee_id        INT NOT NULL REFERENCES enrollee(enrollee_id),
    achievement_id     INT NOT NULL REFERENCES achievement(achievement_id)
);

-- Предметы ЕГЭ абитуриента с результатами
CREATE TABLE IF NOT EXISTS enrollee_subject (
    enrollee_subject_id SERIAL PRIMARY KEY,
    enrollee_id         INT NOT NULL REFERENCES enrollee(enrollee_id),
    subject_id          INT NOT NULL REFERENCES subject(subject_id),
    result              INT NOT NULL  -- балл ЕГЭ
);

-- Предметы ЕГЭ, необходимые для поступления на программу + минимальный балл
CREATE TABLE IF NOT EXISTS program_subject (
    program_subject_id SERIAL PRIMARY KEY,
    program_id         INT NOT NULL REFERENCES program(program_id),
    subject_id         INT NOT NULL REFERENCES subject(subject_id),
    min_result         INT NOT NULL  -- минимальный балл для поступления
);

-- Заявления абитуриентов на образовательные программы
CREATE TABLE IF NOT EXISTS program_enrollee (
    program_enrollee_id SERIAL PRIMARY KEY,
    program_id          INT NOT NULL REFERENCES program(program_id),
    enrollee_id         INT NOT NULL REFERENCES enrollee(enrollee_id)
);

INSERT INTO department (name_department) VALUES
    ('Институт информационных технологий'),
    ('Институт экономики и управления'),
    ('Физический факультет');

INSERT INTO program (name_program, department_id, plan) VALUES
    ('Прикладная информатика',    1, 3),
    ('Программная инженерия',     1, 2),
    ('Экономика',                 2, 4),
    ('Менеджмент',                2, 3),
    ('Физика',                    3, 2);

INSERT INTO subject (name_subject) VALUES
    ('Математика'),        -- 1
    ('Русский язык'),      -- 2
    ('Информатика'),       -- 3
    ('Физика'),            -- 4
    ('Обществознание');    -- 5

INSERT INTO enrollee (name_enrollee) VALUES
    ('Абрамов Петр Александрович'),    -- 1
    ('Баранов Вадим Максимович'),      -- 2
    ('Попов Илья Владимирович'),       -- 3
    ('Семенов Иван Николаевич'),       -- 4
    ('Степанов Андрей Сергеевич');     -- 5

INSERT INTO achievement (name_achievement, bonus) VALUES
    ('Золотая медаль', 10),
    ('Значок ГТО',      5),
    ('Серебряная медаль', 7);

-- Достижения абитуриентов
INSERT INTO enrollee_achievement (enrollee_id, achievement_id) VALUES
    (1, 1),  -- Абрамов — золотая медаль
    (2, 2),  -- Баранов  — значок ГТО
    (3, 1),  -- Попов    — золотая медаль
    (3, 2),  -- Попов    — значок ГТО
    (4, 3);  -- Семенов  — серебряная медаль

-- Результаты ЕГЭ абитуриентов
INSERT INTO enrollee_subject (enrollee_id, subject_id, result) VALUES
    (1, 1, 88), (1, 2, 74), (1, 3, 91),  -- Абрамов
    (2, 1, 75), (2, 2, 80), (2, 3, 68),  -- Баранов
    (3, 1, 95), (3, 2, 83), (3, 3, 97),  -- Попов
    (4, 1, 62), (4, 2, 70), (4, 5, 78),  -- Семенов
    (5, 1, 55), (5, 2, 65), (5, 4, 72);  -- Степанов

-- Требования предметов для программ
INSERT INTO program_subject (program_id, subject_id, min_result) VALUES
    (1, 1, 60), (1, 2, 50), (1, 3, 60),  -- Прикладная информатика
    (2, 1, 65), (2, 2, 55), (2, 3, 65),  -- Программная инженерия
    (3, 1, 55), (3, 2, 55), (3, 5, 60),  -- Экономика
    (4, 1, 50), (4, 2, 45), (4, 5, 55),  -- Менеджмент
    (5, 1, 60), (5, 2, 50), (5, 4, 60);  -- Физика

-- Заявления (каждый подаёт не более чем на 3 программы)
INSERT INTO program_enrollee (program_id, enrollee_id) VALUES
    (1, 1), (2, 1), (3, 1),  -- Абрамов → 3 программы
    (1, 2), (2, 2),           -- Баранов  → 2 программы
    (1, 3), (2, 3),           -- Попов    → 2 программы
    (3, 4), (4, 4),           -- Семенов  → 2 программы
    (4, 5), (5, 5);           -- Степанов → 2 программы

SELECT
    e.name_enrollee   AS "Абитуриент",
    p.name_program    AS "Образовательная программа"
FROM program_enrollee pe
JOIN enrollee e ON e.enrollee_id = pe.enrollee_id
JOIN program  p ON p.program_id  = pe.program_id
WHERE p.name_program = 'Программная инженерия'  -- <- подставить нужную программу
ORDER BY e.name_enrollee;

SELECT
    p.name_program AS "Образовательная программа",
    s.name_subject AS "Предмет ЕГЭ"
FROM program_subject ps
JOIN program p ON p.program_id = ps.program_id
JOIN subject s ON s.subject_id = ps.subject_id
WHERE s.name_subject = 'Информатика'  -- <- подставить нужный предмет
ORDER BY p.name_program;

SELECT
    s.name_subject       AS "Предмет",
    MIN(es.result)       AS "Минимальный балл",
    MAX(es.result)       AS "Максимальный балл",
    COUNT(es.enrollee_id) AS "Количество абитуриентов"
FROM enrollee_subject es
JOIN subject s ON s.subject_id = es.subject_id
GROUP BY s.name_subject
ORDER BY s.name_subject;

SELECT
    p.name_program AS "Образовательная программа"
FROM program_subject ps
JOIN program p ON p.program_id = ps.program_id
GROUP BY p.name_program
HAVING MIN(ps.min_result) > 55  -- <- задать нужное значение
ORDER BY p.name_program;

SELECT
    p.name_program AS "Образовательная программа",
    p.plan         AS "План набора"
FROM program p
WHERE p.plan = (SELECT MAX(plan) FROM program)
ORDER BY p.name_program;

SELECT
    e.name_enrollee      AS "Абитуриент",
    COALESCE(SUM(a.bonus), 0) AS "Дополнительные баллы"
FROM enrollee e
LEFT JOIN enrollee_achievement ea ON ea.enrollee_id    = e.enrollee_id
LEFT JOIN achievement          a  ON a.achievement_id  = ea.achievement_id
GROUP BY e.name_enrollee
ORDER BY "Дополнительные баллы" DESC, e.name_enrollee;

SELECT
    p.name_program                                       AS "Образовательная программа",
    p.plan                                               AS "Мест",
    COUNT(pe.enrollee_id)                                AS "Заявлений",
    ROUND(COUNT(pe.enrollee_id)::NUMERIC / p.plan, 2)   AS "Конкурс (чел/место)"
FROM program p
LEFT JOIN program_enrollee pe ON pe.program_id = p.program_id
GROUP BY p.program_id, p.name_program, p.plan
ORDER BY "Конкурс (чел/место)" DESC;

SELECT
    p.name_program AS "Образовательная программа"
FROM program_subject ps
JOIN program p ON p.program_id = ps.program_id
JOIN subject s ON s.subject_id = ps.subject_id
WHERE s.name_subject IN ('Математика', 'Информатика')
GROUP BY p.name_program
HAVING COUNT(DISTINCT s.subject_id) = 2
ORDER BY p.name_program;

SELECT
    e.name_enrollee  AS "Абитуриент",
    p.name_program   AS "Образовательная программа",
    SUM(es.result)   AS "Сумма баллов ЕГЭ"
FROM program_enrollee pe
JOIN enrollee          e  ON e.enrollee_id = pe.enrollee_id
JOIN program           p  ON p.program_id  = pe.program_id
JOIN program_subject   ps ON ps.program_id = pe.program_id
JOIN enrollee_subject  es ON es.enrollee_id = pe.enrollee_id
                          AND es.subject_id = ps.subject_id
GROUP BY e.name_enrollee, p.name_program
ORDER BY p.name_program, "Сумма баллов ЕГЭ" DESC;

SELECT DISTINCT
    e.name_enrollee AS "Абитуриент",
    p.name_program  AS "Программа",
    s.name_subject  AS "Предмет (не прошёл)",
    es.result       AS "Балл абитуриента",
    ps.min_result   AS "Минимальный балл"
FROM program_enrollee pe
JOIN enrollee         e  ON e.enrollee_id = pe.enrollee_id
JOIN program          p  ON p.program_id  = pe.program_id
JOIN program_subject  ps ON ps.program_id = pe.program_id
JOIN subject          s  ON s.subject_id  = ps.subject_id
JOIN enrollee_subject es ON es.enrollee_id = pe.enrollee_id
                         AND es.subject_id = ps.subject_id
WHERE es.result < ps.min_result
ORDER BY p.name_program, e.name_enrollee;

DROP TABLE IF EXISTS applicant;

CREATE TABLE applicant AS
SELECT
    pe.program_id,
    pe.enrollee_id,
    SUM(es.result) AS total_score
FROM program_enrollee pe
JOIN program_subject  ps ON ps.program_id  = pe.program_id
JOIN enrollee_subject es ON es.enrollee_id = pe.enrollee_id
                         AND es.subject_id = ps.subject_id
GROUP BY pe.program_id, pe.enrollee_id;

DELETE FROM applicant
WHERE (program_id, enrollee_id) IN (
    SELECT pe.program_id, pe.enrollee_id
    FROM program_enrollee pe
    JOIN program_subject  ps ON ps.program_id  = pe.program_id
    JOIN enrollee_subject es ON es.enrollee_id = pe.enrollee_id
                             AND es.subject_id = ps.subject_id
    WHERE es.result < ps.min_result
);

UPDATE applicant a
SET total_score = a.total_score + bonus_sum.total_bonus
FROM (
    SELECT
        ea.enrollee_id,
        SUM(ach.bonus) AS total_bonus
    FROM enrollee_achievement ea
    JOIN achievement ach ON ach.achievement_id = ea.achievement_id
    GROUP BY ea.enrollee_id
) AS bonus_sum
WHERE a.enrollee_id = bonus_sum.enrollee_id;

SELECT
    p.name_program  AS "Программа",
    e.name_enrollee AS "Абитуриент",
    a.total_score   AS "Итоговый балл",
    RANK() OVER (
        PARTITION BY a.program_id
        ORDER BY a.total_score DESC
    ) AS "Место"
FROM applicant a
JOIN program  p ON p.program_id  = a.program_id
JOIN enrollee e ON e.enrollee_id = a.enrollee_id
ORDER BY p.name_program, "Место";

