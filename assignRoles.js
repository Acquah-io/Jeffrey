module.exports = async function assignRoles(member) {
  const guild = member.guild;
  console.log(`Assigning roles for: ${member.user.tag}`);

  const studentRole = guild.roles.cache.find(role => role.name === "Students");
  if (studentRole) {
    try {
      await member.roles.add(studentRole);
      console.log(`Assigned Students role to ${member.user.tag}`);
    } catch (error) {
      console.error(`Failed to assign Students role to ${member.user.tag}:`, error);
    }
  } else {
    console.error("Students role not found!");
  }
};